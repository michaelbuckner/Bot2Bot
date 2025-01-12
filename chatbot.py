import os
from typing import Dict
import requests
from dotenv import load_dotenv
from openai import OpenAI
from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel
import time
from fastapi.middleware.cors import CORSMiddleware
import hmac
import hashlib
import json
import logging
import uuid
from typing import Optional

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

# Add these new classes for login
class LoginRequest(BaseModel):
    username: str
    password: str

class User(BaseModel):
    username: str

# Add session management
sessions = {}

def get_current_user(request: Request) -> Optional[User]:
    session_id = request.cookies.get("session_id")
    if session_id and session_id in sessions:
        return sessions[session_id]
    return None

# Update the root route to check for authentication
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, user: Optional[User] = Depends(get_current_user)):
    if not user:
        return RedirectResponse(url="/login")
    return templates.TemplateResponse("index.html", {"request": request})

# Add login page route
@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, user: Optional[User] = Depends(get_current_user)):
    if user:
        return RedirectResponse(url="/")
    return templates.TemplateResponse("login.html", {"request": request})

# Add login endpoint
@app.post("/login")
async def login(login_request: LoginRequest):
    try:
        with open("users.json", "r") as f:
            users = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Error reading users database")

    if (login_request.username in users and 
        users[login_request.username]["password"] == login_request.password):
        
        session_id = str(uuid.uuid4())
        sessions[session_id] = User(username=login_request.username)
        
        response = Response(content=json.dumps({"message": "Login successful"}),
                          media_type="application/json")
        response.set_cookie(key="session_id", 
                          value=session_id,
                          httponly=True,
                          max_age=3600)  # 1 hour
        return response
    
    raise HTTPException(status_code=401, detail="Invalid username or password")

# Add logout endpoint
@app.post("/logout")
async def logout(response: Response):
    response = RedirectResponse(url="/login")
    response.delete_cookie(key="session_id")
    return response

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
            message = json.dumps(parsed_payload, separators=(',', ':'))
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

            # If the top-level is a list, capture the conversationId and remove StartConversation items
            conversation_id = None
            if isinstance(response_data, list):
                filtered_response = []
                for item in response_data:
                    if item.get("uiType") == "OutputText":
                        try:
                            parsed_value = json.loads(item.get("value", "{}"))
                            if (parsed_value.get("uiType") == "ActionMsg"
                                and parsed_value.get("actionType") == "StartConversation"):
                                conversation_id = parsed_value.get("conversationId")
                                continue  # skip adding this item to filtered_response
                        except (ValueError, TypeError, json.JSONDecodeError):
                            pass
                    filtered_response.append(item)

                # Store filtered items under "body"
                # and keep the conversationId for reference in the final output
                response_data = {
                    "conversationId": conversation_id,
                    "body": filtered_response
                }

            # Log details
            logger.info("Captured conversationId: %s", conversation_id)
            logger.info("ServiceNow Response Type: %s", type(response_data))

            # Ensure response_data is a dict with "body" as a list
            if not isinstance(response_data, dict):
                logger.warning("Response is not a dictionary, wrapping it")
                response_data = {
                    "conversationId": conversation_id,
                    "body": [{
                        "uiType": "OutputText",
                        "value": str(response_data)
                    }]
                }
            elif "body" not in response_data:
                logger.warning("Response missing 'body' field, adding it")
                response_data["body"] = [{
                    "uiType": "OutputText",
                    "value": json.dumps(response_data)
                }]
            elif not isinstance(response_data["body"], list):
                logger.warning("Body is not a list, converting it")
                response_data["body"] = [{
                    "uiType": "OutputText",
                    "value": str(response_data["body"])
                }]

            # Validate each item in the body
            validated_body = []
            for item in response_data.get("body", []):
                if isinstance(item, dict) and "value" in item:
                    try:
                        parsed_value = json.loads(item["value"])
                        # Skip if it's another StartConversation
                        if (parsed_value.get("uiType") == "ActionMsg"
                            and parsed_value.get("actionType") == "StartConversation"):
                            continue
                    except (ValueError, TypeError):
                        pass

                # Basic validation
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
                "conversationId": None,
                "body": [{
                    "uiType": "OutputText",
                    "value": f"Error communicating with ServiceNow: {str(e)}"
                }]
            }
        except json.JSONDecodeError as e:
            logger.error("JSON decode error: %s", str(e))
            return {
                "conversationId": None,
                "body": [{
                    "uiType": "OutputText",
                    "value": f"Invalid JSON response from ServiceNow: {str(e)}"
                }]
            }
        except Exception as e:
            logger.error("Unexpected error: %s", str(e))
            return {
                "conversationId": None,
                "body": [{
                    "uiType": "OutputText",
                    "value": f"Unexpected error: {str(e)}"
                }]
            }

class ServiceNowCallback(BaseModel):
    conversationId: str
    body: list

class AsyncResponse(BaseModel):
    request_id: str
    status: str
    message: str

# Basic auth security
security = HTTPBasic()

def verify_callback_credentials(credentials: HTTPBasicCredentials):
    correct_username = os.getenv("CALLBACK_USERNAME")
    correct_password = os.getenv("CALLBACK_PASSWORD")
    
    if not (credentials.username == correct_username and 
            credentials.password == correct_password):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return True

# Store pending responses
pending_responses = {}

@app.post("/servicenow/callback")
async def servicenow_callback(
    callback: ServiceNowCallback,
    credentials: HTTPBasicCredentials = Depends(security)
):
    verify_callback_credentials(credentials)
    
    # Store the response in pending_responses
    if callback.conversationId in pending_responses:
        pending_responses[callback.conversationId] = callback.body
        
    return {"status": "success"}

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
async def chat(chat_message: ChatMessage, user: Optional[User] = Depends(get_current_user)):
    """Handle chat messages"""
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    try:
        if chat_message.use_servicenow:
            response = servicenow_api.send_message_to_va(
                chat_message.message, 
                chat_message.session_id
            )
            
            # Get the conversation_id from the response
            conversation_id = response.get("conversationId")
            
            # Store the response body in pending_responses
            if conversation_id:
                pending_responses[conversation_id] = response.get("body", [])
            
            # Return immediately with a pending status
            return AsyncResponse(
                request_id=conversation_id,  # Use conversation_id as the request_id
                status="pending",
                message="Request is being processed"
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
