from fastapi import FastAPI, HTTPException, Request, Response, Depends, Cookie, Header, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field
import time
import json
import os
import requests
import logging
from openai import OpenAI
import uuid
from typing import Optional
import random
from dotenv import load_dotenv
import hmac
import hashlib
import traceback
from logging import getLogger
from typing import List

# Set up logging
logger = getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S'))
logger.addHandler(handler)

# Load environment variables
load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

# Mount static files and templates
static_files = StaticFiles(directory="static")
app.mount("/static", static_files, name="static")
templates = Jinja2Templates(directory="templates")

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
    return FileResponse("static/index.html")

# Add login page route
@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, user: Optional[User] = Depends(get_current_user)):
    if user:
        return RedirectResponse(url="/")
    return templates.TemplateResponse("login.html", {"request": request})

# Update the login endpoint
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
        
        response = JSONResponse(
            content={"message": "Login successful"}
        )
        response.set_cookie(
            key="session_id",
            value=session_id,
            httponly=True,
            secure=False,  # Set to True in production
            samesite='lax',
            max_age=1800  # 30 minutes
        )
        return response
    
    raise HTTPException(status_code=401, detail="Invalid username or password")

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
                "clientSessionId": session_id[:6] if session_id else "",
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

            logger.info("=== Sending Request to ServiceNow ===")
            logger.info("Payload: %s", payload)
            response = requests.post(
                f"https://{self.instance_url}/api/sn_va_as_service/bot/integration",
                headers=headers,
                auth=self.auth,
                data=payload
            )

            logger.info("ServiceNow Response Status: %s", response.status_code)
            logger.info("ServiceNow Raw Response Content: %s", response.text)

            response.raise_for_status()
            
            # Parse the response
            try:
                response_data = response.json()
                logger.info("ServiceNow Response Data: %s", json.dumps(response_data, indent=2))
                
                # Check if we have an immediate response
                if response_data.get('body'):
                    # Convert the response to our format
                    formatted_messages = []
                    for msg in response_data['body']:
                        if not isinstance(msg, dict):
                            continue

                        # Handle different message types
                        if msg.get('uiType') in ['ActionMsg', 'OutputCard', 'Picker']:
                            # Pass through known message types unchanged
                            formatted_messages.append(msg)
                        else:
                            # Convert unknown message types to OutputCard format
                            message_text = msg.get('text') or msg.get('message') or str(msg)
                            formatted_messages.append({
                                "uiType": "OutputCard",
                                "group": "DefaultOutputCard",
                                "templateName": "Card",
                                "data": json.dumps({
                                    "title": "ServiceNow Response",
                                    "fields": [
                                        {
                                            "fieldLabel": "Top Result:",
                                            "fieldValue": message_text
                                        }
                                    ]
                                })
                            })
                    
                    # Store the formatted messages
                    if formatted_messages:
                        logger.info("Storing %d immediate messages for request %s",
                                  len(formatted_messages), request_id)
                        pending_responses[request_id] = formatted_messages
                        logger.info("Stored messages: %s",
                                  json.dumps(formatted_messages, indent=2))
                
            except json.JSONDecodeError:
                logger.warning("ServiceNow response was not JSON")
            
            # Return the requestId for async processing
            return {
                "status": "success",
                "requestId": request_id
            }

        except requests.exceptions.RequestException as e:
            logger.error("Error sending message to ServiceNow VA: %s", str(e))
            if hasattr(e.response, 'text'):
                logger.error("Error response content: %s", e.response.text)
            return {
                "status": "error",
                "error": f"Error communicating with ServiceNow: {str(e)}"
            }
        except Exception as e:
            logger.error("Unexpected error: %s", str(e))
            return {
                "status": "error",
                "error": f"Unexpected error: {str(e)}"
            }

servicenow_api = ServiceNowAPI(
    instance_url=os.getenv('SERVICENOW_INSTANCE'),
    username=os.getenv('SERVICENOW_USERNAME'),
    password=os.getenv('SERVICENOW_PASSWORD'),
    token=os.getenv('SERVICENOW_TOKEN')
)

class ChatbotAPI:
    def __init__(self):
        self.message_store = {}
        self.logger = getLogger(__name__)

    def store_messages(self, request_id: str, messages: List[dict]):
        """Store formatted messages for a request."""
        # For action messages, we want to accumulate them
        if len(messages) == 1 and messages[0].get('uiType') == 'ActionMsg':
            if request_id not in self.message_store:
                self.message_store[request_id] = []
            self.message_store[request_id].append(messages[0])
        else:
            # For content messages (OutputCard, Picker), replace existing messages
            self.message_store[request_id] = messages
        
        self.logger.info(f"Updated messages for request {request_id}: {json.dumps(self.message_store[request_id], indent=2)}")
        return self.message_store[request_id]

    def get_messages(self, request_id: str) -> List[dict]:
        """Get stored messages for a request."""
        return self.message_store.get(request_id, [])

    def process_servicenow_callback(self, callback_data) -> List[dict]:
        """Process a callback from ServiceNow and return formatted messages."""
        request_id = callback_data.requestId  # Access Pydantic model field directly
        messages = []

        for msg in callback_data.body:  # Access body field directly
            self.logger.info(f"Processing message: {json.dumps(msg, indent=2)}")
            
            # Convert to dict to ensure consistent access
            msg_dict = msg if isinstance(msg, dict) else msg.dict()
            
            if msg_dict['uiType'] == 'ActionMsg':
                messages.append(msg_dict)
            elif msg_dict['uiType'] == 'OutputCard':
                # Clear previous messages when we get content
                messages = [msg_dict]
            elif msg_dict['uiType'] == 'Picker':
                if not any(m['uiType'] == 'Picker' for m in messages):
                    messages.append(msg_dict)

        self.logger.info(f"Added {len(messages)} formatted messages")
        return self.store_messages(request_id, messages)

chatbot_api = ChatbotAPI()

class ServiceNowCallback(BaseModel):
    requestId: str | None = None
    body: list | dict | None = None
    clientSessionId: str | None = None
    message: dict | None = None

    class Config:
        extra = "allow"

@app.post("/servicenow/callback")
async def servicenow_callback(callback: ServiceNowCallback):
    """Handle callbacks from ServiceNow."""
    try:
        logger.info("=== ServiceNow Callback Received ===")
        logger.info(f"Raw callback body: {callback.model_dump_json()}")
        logger.info(f"Parsed callback body: {json.dumps(json.loads(callback.model_dump_json()), indent=2)}")
        logger.info(f"Callback object: {callback}")
        
        logger.info(f"Processing callback for requestId: {callback.requestId}")
        formatted_messages = chatbot_api.process_servicenow_callback(callback)
        logger.info(f"Formatted messages: {json.dumps(formatted_messages, indent=2)}")
        
        # Store the formatted messages
        if formatted_messages:
            logger.info(f"Storing {len(formatted_messages)} formatted messages for request {callback.requestId}")
            pending_responses[callback.requestId] = formatted_messages
            logger.info(f"Stored messages: {json.dumps(formatted_messages, indent=2)}")
        
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error processing ServiceNow callback: {str(e)}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))

def get_gpt_response(message: str) -> str:
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
async def chat(
    request: ChatMessage,
    user: Optional[User] = Depends(get_current_user)
):
    """Handle chat messages from the frontend."""
    logger.info(f"Received chat request: {request}")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        if request.use_servicenow:
            # Send to ServiceNow
            logger.info("Using ServiceNow API")
            response = servicenow_api.send_message_to_va(request.message, request.session_id)
            logger.info("ServiceNow API Response: %s", response)
            
            if response.get("status") == "success":
                return {
                    "servicenow_response": {
                        "status": "success",
                        "requestId": response.get("requestId")
                    }
                }
            else:
                logger.error("ServiceNow API Error: %s", response.get("error"))
                raise HTTPException(
                    status_code=500,
                    detail=f"ServiceNow API Error: {response.get('error', 'Unknown error')}"
                )
        else:
            # Use GPT
            logger.info("Using GPT API")
            response = get_gpt_response(request.message)
            logger.info("GPT Response: %s", response)
            return {"response": response}
            
    except Exception as e:
        logger.error("Error in chat endpoint: %s", str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

pending_responses = {}

@app.get("/servicenow/responses/{request_id}")
async def get_servicenow_responses(request_id: str, acknowledge: bool = False, user: Optional[User] = Depends(get_current_user)):
    """Get responses for a specific request ID."""
    logger.info("=== Get ServiceNow Responses ===")
    logger.info("Request ID: %s", request_id)
    logger.info("Acknowledge: %s", acknowledge)
    logger.info("User: %s", user)

    if not user:
        logger.error("Authentication failed")
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        if request_id not in pending_responses:
            logger.info("No responses found for request ID")
            return {"servicenow_response": {"body": []}}

        response_data = pending_responses[request_id]
        logger.info("Found response data: %s", json.dumps(response_data, indent=2))

        if acknowledge:
            logger.info("Acknowledging and removing response")
            pending_responses.pop(request_id)
            return {"servicenow_response": {"body": []}}

        if not response_data:
            logger.info("Response data is empty")
            return {"servicenow_response": {"body": []}}

        logger.info("Returning response with %d messages", len(response_data))
        logger.info("Response body: %s", json.dumps(response_data, indent=2))
        return {"servicenow_response": {"body": response_data}}

    except Exception as e:
        logger.error("Error getting responses: %s", str(e))
        logger.error("Stack trace: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/poll/{request_id}")
async def poll_request(request_id: str, acknowledge: bool = False, user: Optional[User] = Depends(get_current_user)):
    """Get responses for a specific request ID."""
    logger.info("=== Poll Request ===")
    logger.info("Request ID: %s", request_id)
    logger.info("Acknowledge: %s", acknowledge)
    logger.info("User: %s", user)

    if not user:
        logger.error("Authentication failed")
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        if request_id not in pending_responses:
            logger.info("No responses found for request ID")
            return {"servicenow_response": {"body": []}}

        response_data = pending_responses[request_id]
        logger.info("Found response data: %s", json.dumps(response_data, indent=2))

        if acknowledge:
            logger.info("Acknowledging and removing response")
            pending_responses.pop(request_id)
            return {"servicenow_response": {"body": []}}

        if not response_data:
            logger.info("Response data is empty")
            return {"servicenow_response": {"body": []}}

        logger.info("Returning response with %d messages", len(response_data))
        logger.info("Response body: %s", json.dumps(response_data, indent=2))
        return {"servicenow_response": {"body": response_data}}

    except Exception as e:
        logger.error("Error getting responses: %s", str(e))
        logger.error("Stack trace: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/debug/pending_responses")
async def debug_pending_responses(
    user: Optional[User] = Depends(get_current_user)
):
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    logger.info("Current pending_responses: %s", json.dumps(pending_responses, indent=2))
    return {
        "pending_responses": pending_responses,
        "count": len(pending_responses)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
