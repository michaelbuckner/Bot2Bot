import os
import json
import hmac
import hashlib
import logging
import uuid
import requests
import time
from typing import Dict, Optional
from dotenv import load_dotenv
from openai import OpenAI
from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Set up logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Load environment variables
load_dotenv()

# Initialize FastAPI and OpenAI client
app = FastAPI()
client = OpenAI()

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class LoginRequest(BaseModel):
    username: str
    password: str

class User(BaseModel):
    username: str

class ChatMessage(BaseModel):
    message: str
    session_id: str
    use_servicenow: bool = False

class ServiceNowCallback(BaseModel):
    requestId: Optional[str] = None
    body: Optional[Dict | list] = None
    clientSessionId: Optional[str] = None
    message: Optional[Dict] = None

    class Config:
        extra = "allow"

class AsyncResponse(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: str
    message: str

# Session management
sessions = {}

def get_current_user(request: Request) -> Optional[User]:
    session_id = request.cookies.get("session_id")
    return sessions.get(session_id) if session_id else None

# Routes
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, user: Optional[User] = Depends(get_current_user)):
    if not user:
        return RedirectResponse(url="/login")
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, user: Optional[User] = Depends(get_current_user)):
    if user:
        return RedirectResponse(url="/")
    return templates.TemplateResponse("login.html", {"request": request})

@app.post("/login")
async def login(login_request: LoginRequest):
    try:
        with open("users.json", "r") as f:
            users = json.load(f)
    except Exception:
        raise HTTPException(status_code=500, detail="Error reading users database")

    user_data = users.get(login_request.username)
    if user_data and user_data["password"] == login_request.password:
        session_id = str(uuid.uuid4())
        sessions[session_id] = User(username=login_request.username)
        response = Response(content=json.dumps({"message": "Login successful"}), media_type="application/json")
        response.set_cookie(key="session_id", value=session_id, httponly=True, max_age=3600)
        return response

    raise HTTPException(status_code=401, detail="Invalid username or password")

@app.post("/logout")
async def logout(response: Response):
    response = RedirectResponse(url="/login")
    response.delete_cookie(key="session_id")
    return response

@app.post("/chat")
async def chat(chat_message: ChatMessage, user: Optional[User] = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        if chat_message.use_servicenow:
            response = servicenow_api.send_message_to_va(chat_message.message, chat_message.session_id)
            return {
                "servicenow_response": {
                    "body": response.get("body", []),
                    "requestId": response.get("requestId")
                }
            }
        else:
            gpt_response = get_gpt_response(chat_message.message)
            return {"response": gpt_response}
    except Exception as e:
        logger.error("Error in chat endpoint: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/servicenow/callback")
async def servicenow_callback(request: Request, credentials: HTTPBasicCredentials = Depends(HTTPBasic())):
    verify_callback_credentials(credentials)
    body = await request.json()
    logger.info("Received callback from ServiceNow: %s", json.dumps(body, indent=2))

    try:
        callback = ServiceNowCallback(**body)
        if callback.requestId:
            pending_responses[callback.requestId] = callback.body or []
        return {"status": "success"}
    except Exception as e:
        logger.error("Error processing ServiceNow callback: %s", str(e), exc_info=True)
        raise HTTPException(status_code=400, detail=f"Error processing callback: {str(e)}")

# Helper functions
def verify_callback_credentials(credentials: HTTPBasicCredentials):
    correct_username = os.getenv("CALLBACK_USERNAME")
    correct_password = os.getenv("CALLBACK_PASSWORD")
    if credentials.username != correct_username or credentials.password != correct_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

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

            # Ensure response_data is a dict with "body" as a list
            if not isinstance(response_data, dict):
                response_data = {
                    "requestId": request_id,
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
                response_data["body"] = [{
                    "uiType": "OutputText",
                    "value": str(response_data["body"])
                }]

            return response_data

        except requests.exceptions.RequestException as e:
            logger.error("Error sending message to ServiceNow VA: %s", str(e))
            if hasattr(e.response, 'text'):
                logger.error("Error response content: %s", e.response.text)
            return {
                "requestId": None,
                "body": [{
                    "uiType": "OutputText",
                    "value": f"Error communicating with ServiceNow: {str(e)}"
                }]
            }
        except Exception as e:
            logger.error("Unexpected error: %s", str(e))
            return {
                "requestId": None,
                "body": [{
                    "uiType": "OutputText",
                    "value": f"Unexpected error: {str(e)}"
                }]
            }

# Initialize ServiceNow API client
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

# Main execution
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
