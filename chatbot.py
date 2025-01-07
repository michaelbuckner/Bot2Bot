import os
from typing import Dict
import requests
from dotenv import load_dotenv
from openai import OpenAI
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import time
from fastapi.middleware.cors import CORSMiddleware
import hmac
import hashlib
import json
import logging
import uuid

# Set up logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Load environment variables
load_dotenv()

app = FastAPI()
client = OpenAI()

# Mount static files and templates
static_files = StaticFiles(directory="static")
app.mount("/static", static_files, name="static")
templates = Jinja2Templates(directory="templates")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

class ChatMessage(BaseModel):
    message: str
    session_id: str
    use_servicenow: bool = False

class ServiceNowAPI:
    def __init__(self, instance_url, username, password, token):
        self.instance_url = instance_url
        self.username = username
        self.password = password
        self.token = token
        self.auth = (username, password)

    def generate_signature(self, payload):
        try:
            parsed_payload = json.loads(payload)
            message = json.dumps(parsed_payload, separators=(',', ':'))  # remove whitespace
            hash_value = hmac.new(
                self.token.encode('utf-8'),
                message.encode('utf-8'),
                hashlib.sha1
            ).hexdigest()
            return hash_value
        except Exception as e:
            logger.error(f"Error generating signature: {str(e)}")
            raise ValueError("Failed to generate signature.")

    def send_message_to_va(self, message, session_id):
        try:
            request_id = str(uuid.uuid4())
            client_message_id = f"MSG-{uuid.uuid4().hex[:6]}"

            payload = json.dumps({
                "requestId": request_id,
                "clientSessionId": session_id,
                "nowSessionId": "",
                "message": {
                    "text": message,
                    "typed": "true",
                    "clientMessageId": client_message_id
                },
                "userId": "beth.anglin"
            })

            signature = self.generate_signature(payload)

            headers = {
                'Content-Type': 'application/json',
                'x-b2b-signature': signature
            }

            logger.info("Sending request to ServiceNow with payload: %s", payload)

            response = requests.post(
                f"https://{self.instance_url}/api/sn_va_as_service/bot/integration",
                headers=headers,
                auth=self.auth,
                data=payload
            )

            logger.info("ServiceNow Response Status: %s", response.status_code)
            logger.info("ServiceNow Raw Response Content: %s", response.text)

            response.raise_for_status()
            response_data = response.json()
            
            # Log detailed response information
            logger.info("ServiceNow Response Type: %s", type(response_data))
            logger.info("ServiceNow Response Keys: %s", list(response_data.keys()) if isinstance(response_data, dict) else "Not a dict")
            
            if isinstance(response_data, dict) and "body" in response_data:
                logger.info("ServiceNow Body Type: %s", type(response_data["body"]))
                if isinstance(response_data["body"], list):
                    for idx, item in enumerate(response_data["body"]):
                        logger.info("Body Item %d: %s", idx, item)

            # Normalize response
            if not isinstance(response_data, dict):
                logger.warning("Response is not a dictionary, wrapping it")
                response_data = {
                    "body": [{
                        "uiType": "OutputText",
                        "value": str(response_data)
                    }]
                }
            elif "body" not in response_data:
                logger.warning("Response missing 'body' field, adding it")
                response_data = {
                    "body": [{
                        "uiType": "OutputText",
                        "value": json.dumps(response_data)
                    }]
                }
            elif not isinstance(response_data["body"], list):
                logger.warning("Body is not a list, converting it")
                response_data["body"] = [{
                    "uiType": "OutputText",
                    "value": str(response_data["body"])
                }]

            # Validate each item in the body
            if isinstance(response_data.get("body"), list):
                validated_body = []
                for item in response_data["body"]:
                    if not isinstance(item, dict):
                        validated_body.append({
                            "uiType": "OutputText",
                            "value": str(item)
                        })
                    elif "uiType" not in item or "value" not in item:
                        validated_body.append({
                            "uiType": "OutputText",
                            "value": json.dumps(item)
                        })
                    else:
                        validated_body.append(item)
                response_data["body"] = validated_body

            logger.info("Final normalized response: %s", json.dumps(response_data))
            return response_data

        except requests.exceptions.RequestException as e:
            logger.error("Error sending message to ServiceNow VA: %s", str(e))
            if hasattr(e.response, 'text'):
                logger.error("Error response content: %s", e.response.text)
            return {
                "body": [{
                    "uiType": "OutputText",
                    "value": f"Error communicating with ServiceNow: {str(e)}"
                }]
            }
        except json.JSONDecodeError as e:
            logger.error("JSON decode error: %s", str(e))
            return {
                "body": [{
                    "uiType": "OutputText",
                    "value": f"Invalid JSON response from ServiceNow: {str(e)}"
                }]
            }
        except Exception as e:
            logger.error("Unexpected error: %s", str(e))
            return {
                "body": [{
                    "uiType": "OutputText",
                    "value": f"Unexpected error: {str(e)}"
                }]
            }

servicenow_api = ServiceNowAPI(
    instance_url=os.getenv('SERVICENOW_INSTANCE'),
    username=os.getenv('SERVICENOW_USERNAME'),
    password=os.getenv('SERVICENOW_PASSWORD'),
    token=os.getenv('SERVICENOW_TOKEN')
)

def get_gpt_response(message: str) -> str:
    """Get response from GPT"""
    try:
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": message}
            ]
        )
        return response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GPT API error: {str(e)}")

@app.post("/chat")
async def chat(chat_message: ChatMessage):
    """Handle chat messages"""
    try:
        if chat_message.use_servicenow:
            try:
                snow_response = servicenow_api.send_message_to_va(
                    chat_message.message,
                    chat_message.session_id
                )
                logger.info("ServiceNow response received: %s", json.dumps(snow_response, indent=2))
                return {"servicenow_response": snow_response}
            except Exception as snow_error:
                logger.error("ServiceNow Error: %s", str(snow_error))
                raise HTTPException(
                    status_code=500,
                    detail=f"ServiceNow Error: {str(snow_error)}"
                )
        else:
            try:
                gpt_response = get_gpt_response(chat_message.message)
                return {"response": gpt_response}
            except Exception as gpt_error:
                logger.error("GPT Error: %s", str(gpt_error))
                raise HTTPException(
                    status_code=500,
                    detail=f"GPT Error: {str(gpt_error)}"
                )
    except Exception as e:
        logger.error("Error in chat endpoint: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
