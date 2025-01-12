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
from pydantic import BaseModel, Field
import time
from fastapi.middleware.cors import CORSMiddleware
import hmac
import hashlib
import json
import logging
import uuid
from typing import Optional
import random

# Set up logging
logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

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
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        if request.use_servicenow:
            # Send request to ServiceNow and get response
            response = servicenow_api.send_message_to_va(request.message, request.session_id)
            
            if response.get("status") == "error":
                raise HTTPException(status_code=500, detail=response.get("error"))
            
            # Return success with requestId for async processing
            return {
                "servicenow_response": {
                    "status": "success",
                    "requestId": response.get("requestId"),
                    "body": []  # Initial empty body, content will come through callbacks
                }
            }
        else:
            gpt_response = get_gpt_response(request.message)
            return {"response": gpt_response}
    except Exception as e:
        logger.error("Error in chat endpoint: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

class ServiceNowCallback(BaseModel):
    requestId: str | None = None
    body: list | dict | None = None
    clientSessionId: str | None = None
    message: dict | None = None

    class Config:
        extra = "allow"

class AsyncResponse(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: str
    message: str

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

pending_responses = {}

@app.post("/servicenow/callback")
async def servicenow_callback(
    request: Request,
    credentials: HTTPBasicCredentials = Depends(security)
):
    verify_callback_credentials(credentials)
    
    # Get raw request body
    raw_body = await request.body()
    logger.info("Raw callback body: %s", raw_body.decode())
    
    # Parse JSON
    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse callback JSON: %s", str(e))
        raise HTTPException(status_code=400, detail="Invalid JSON")

    try:
        callback = ServiceNowCallback(**body)
        
        # Extract request ID from the callback
        request_id = callback.requestId
        if not request_id:
            logger.warning("No requestId in callback")
            return {"status": "error", "message": "No requestId in callback"}

        logger.info("Processing callback for requestId: %s", request_id)
        
        # Process the callback body
        if callback.body:
            if isinstance(callback.body, list):
                # Filter out spinner/action messages
                content_messages = []
                for msg in callback.body:
                    if not isinstance(msg, dict):
                        continue
                        
                    # Skip all ActionMsg types (spinners, etc)
                    if msg.get('uiType') == 'ActionMsg':
                        continue
                        
                    # Keep OutputCard and Picker messages
                    if msg.get('uiType') in ['OutputCard', 'Picker']:
                        content_messages.append(msg)

                if content_messages:
                    logger.info("Storing %d content messages for request %s", 
                              len(content_messages), request_id)
                    
                    # Store only content messages
                    if request_id in pending_responses:
                        # Get existing non-spinner messages
                        existing_messages = [
                            msg for msg in pending_responses[request_id]
                            if isinstance(msg, dict) and msg.get('uiType') != 'ActionMsg'
                        ]
                        # Add new content messages
                        pending_responses[request_id] = existing_messages + content_messages
                    else:
                        pending_responses[request_id] = content_messages
                        
                    logger.info("Updated messages for request %s: %s", 
                              request_id, json.dumps(pending_responses[request_id], indent=2))
            else:
                # If body is not a list, wrap it in a list
                logger.warning("Callback body is not a list, wrapping it: %s", callback.body)
                pending_responses[request_id] = [{
                    "uiType": "OutputText",
                    "value": str(callback.body)
                }]
                
        return {"status": "success"}
    except Exception as e:
        logger.error("Error processing ServiceNow callback: %s", str(e), exc_info=True)
        raise HTTPException(status_code=400, detail=f"Error processing callback: {str(e)}")

@app.get("/servicenow/responses/{request_id}")
async def get_servicenow_responses(request_id: str):
    """Get responses for a specific request ID."""
    
    logger.info("Getting responses for request %s", request_id)
    
    if request_id not in pending_responses:
        logger.warning("No responses found for request %s", request_id)
        return {
            "servicenow_response": {
                "status": "success",
                "body": []
            }
        }
    
    # Get the responses
    responses = pending_responses[request_id]
    
    # Filter out spinner messages
    content_messages = [msg for msg in responses if msg.get("uiType") in ["OutputCard", "Picker"]]
    
    # Only remove from pending_responses if we have content messages
    if content_messages:
        del pending_responses[request_id]
        logger.info("Removed request %s from pending_responses after content delivery", request_id)
    
    logger.info("Returning responses for request %s: %s", 
               request_id, json.dumps(content_messages, indent=2))
    
    return {
        "servicenow_response": {
            "status": "success",
            "body": content_messages
        }
    }

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
