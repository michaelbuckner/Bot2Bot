from fastapi import FastAPI, HTTPException, Request, Response, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
from pydantic import BaseModel
import json
import os
import requests
import logging
from openai import OpenAI
from langsmith.wrappers import wrap_openai
from langsmith import traceable
import uuid
from typing import Optional, List, Union
from dotenv import load_dotenv
import hmac
import hashlib
import traceback

# Set up logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
handler.setFormatter(
    logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
)
logger.addHandler(handler)

# Load environment variables
load_dotenv()

# Global in-memory stores (use persistent storage in production)
sessions: dict[str, "User"] = {}
pending_responses: dict[str, List[dict]] = {}

def load_users() -> dict:
    try:
        with open("users.json", "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error("Error loading users.json: %s", e)
        return {}

USERS_DB = load_users()

# Initialize OpenAI client with LangSmith wrapper
client = wrap_openai(OpenAI(api_key=os.getenv('OPENAI_API_KEY')))

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files and templates
static_files = StaticFiles(directory="static")
app.mount("/static", static_files, name="static")
templates = Jinja2Templates(directory="templates")

# Classes for login
class LoginRequest(BaseModel):
    username: str
    password: str

class User(BaseModel):
    username: str

def get_current_user(request: Request) -> Optional[User]:
    session_id = request.cookies.get("session_id")
    if session_id and session_id in sessions:
        return sessions[session_id]
    return None

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, user: Optional[User] = Depends(get_current_user)):
    if not user:
        return RedirectResponse(url="/login")
    return FileResponse("static/index.html")

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, user: Optional[User] = Depends(get_current_user)):
    if user:
        return RedirectResponse(url="/")
    return templates.TemplateResponse("login.html", {"request": request})

@app.post("/login")
async def login(login_request: LoginRequest):
    # Use cached USERS_DB instead of reading the file each time.
    if (login_request.username in USERS_DB and 
        USERS_DB[login_request.username].get("password") == login_request.password):
        
        session_id = str(uuid.uuid4())
        sessions[session_id] = User(username=login_request.username)
        
        response = JSONResponse(content={"message": "Login successful"})
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
    def __init__(self, instance_url: str, username: str, password: str, token: str):
        self.instance_url = instance_url
        self.username = username
        self.password = password
        self.token = token
        self.auth = (username, password)

    def generate_signature(self, payload: str) -> str:
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
            logger.error("Error generating signature: %s", e)
            raise ValueError("Failed to generate signature.")

    def send_message_to_va(self, message: str, session_id: str) -> dict:
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
                if response_data.get('body'):
                    formatted_messages = []
                    for msg in response_data['body']:
                        if not isinstance(msg, dict):
                            continue
                        if msg.get('uiType') in ['ActionMsg', 'OutputCard', 'Picker']:
                            formatted_messages.append(msg)
                        else:
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
                    if formatted_messages:
                        logger.info("Storing %d immediate messages for request %s", len(formatted_messages), request_id)
                        pending_responses[request_id] = formatted_messages
                        logger.info("Stored messages: %s", json.dumps(formatted_messages, indent=2))
            except json.JSONDecodeError:
                logger.warning("ServiceNow response was not JSON")
            
            return {"status": "success", "requestId": request_id}
        except requests.exceptions.RequestException as e:
            logger.error("Error sending message to ServiceNow VA: %s", e)
            if hasattr(e.response, 'text'):
                logger.error("Error response content: %s", e.response.text)
            return {"status": "error", "error": f"Error communicating with ServiceNow: {str(e)}"}
        except Exception as e:
            logger.error("Unexpected error: %s", e)
            return {"status": "error", "error": f"Unexpected error: {str(e)}"}

servicenow_api = ServiceNowAPI(
    instance_url=os.getenv('SERVICENOW_INSTANCE'),
    username=os.getenv('SERVICENOW_USERNAME'),
    password=os.getenv('SERVICENOW_PASSWORD'),
    token=os.getenv('SERVICENOW_TOKEN')
)

class ChatbotAPI:
    def __init__(self):
        self.message_store: dict[str, List[dict]] = {}
        self.logger = logging.getLogger(__name__)

    def store_messages(self, request_id: str, messages: List[dict]) -> List[dict]:
        # For action messages, accumulate them; for others, replace any existing messages.
        if len(messages) == 1 and messages[0].get('uiType') == 'ActionMsg':
            if request_id not in self.message_store:
                self.message_store[request_id] = []
            self.message_store[request_id].append(messages[0])
        else:
            self.message_store[request_id] = messages
        self.logger.info("Updated messages for request %s: %s", request_id, json.dumps(self.message_store[request_id], indent=2))
        return self.message_store[request_id]

    def get_messages(self, request_id: str) -> List[dict]:
        return self.message_store.get(request_id, [])

    def process_servicenow_callback(self, callback_data: "ServiceNowCallback") -> List[dict]:
        # Ensure body is a list for consistent processing.
        body = callback_data.body if isinstance(callback_data.body, list) else ([callback_data.body] if callback_data.body else [])
        request_id = callback_data.requestId
        messages: List[dict] = []
        for msg in body:
            self.logger.info("Processing message: %s", json.dumps(msg, indent=2))
            msg_dict = msg if isinstance(msg, dict) else msg.dict()
            if msg_dict.get('uiType') == 'ActionMsg':
                messages.append(msg_dict)
            elif msg_dict.get('uiType') == 'OutputCard':
                messages = [msg_dict]
            elif msg_dict.get('uiType') == 'Picker':
                if not any(m.get('uiType') == 'Picker' for m in messages):
                    messages.append(msg_dict)
        self.logger.info("Added %d formatted messages", len(messages))
        return self.store_messages(request_id, messages)

chatbot_api = ChatbotAPI()

class ServiceNowCallback(BaseModel):
    requestId: Optional[str] = None
    body: Optional[Union[list, dict]] = None
    clientSessionId: Optional[str] = None
    message: Optional[dict] = None

    class Config:
        extra = "allow"

@app.post("/servicenow/callback")
async def servicenow_callback(callback: ServiceNowCallback):
    try:
        logger.info("=== ServiceNow Callback Received ===")
        logger.info("Raw callback body: %s", callback.model_dump_json())
        logger.info("Parsed callback body: %s", json.dumps(json.loads(callback.model_dump_json()), indent=2))
        logger.info("Callback object: %s", callback)
        logger.info("Processing callback for requestId: %s", callback.requestId)
        formatted_messages = chatbot_api.process_servicenow_callback(callback)
        logger.info("Formatted messages: %s", json.dumps(formatted_messages, indent=2))
        if formatted_messages:
            logger.info("Storing %d formatted messages for request %s", len(formatted_messages), callback.requestId)
            pending_responses[callback.requestId] = formatted_messages
            logger.info("Stored messages: %s", json.dumps(formatted_messages, indent=2))
        return {"status": "success"}
    except Exception as e:
        logger.error("Error processing ServiceNow callback: %s", e)
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))

@traceable
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
    logger.info("Received chat request: %s", request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        if request.use_servicenow:
            logger.info("Using ServiceNow API")
            response = servicenow_api.send_message_to_va(request.message, request.session_id)
            logger.info("ServiceNow API Response: %s", response)
            if response.get("status") == "success":
                return {"servicenow_response": {"status": "success", "requestId": response.get("requestId")}}
            else:
                logger.error("ServiceNow API Error: %s", response.get("error"))
                raise HTTPException(
                    status_code=500,
                    detail=f"ServiceNow API Error: {response.get('error', 'Unknown error')}"
                )
        else:
            logger.info("Using GPT API")
            response = get_gpt_response(request.message)
            logger.info("GPT Response: %s", response)
            return {"response": response}
    except Exception as e:
        logger.error("Error in chat endpoint: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

def handle_responses(request_id: str, acknowledge: bool) -> dict:
    if request_id not in pending_responses:
        logger.info("No responses found for request ID %s", request_id)
        return {"servicenow_response": {"body": []}}
    response_data = pending_responses[request_id]
    logger.info("Found response data for %s: %s", request_id, json.dumps(response_data, indent=2))
    if acknowledge:
        logger.info("Acknowledging and removing response for %s", request_id)
        pending_responses.pop(request_id)
        return {"servicenow_response": {"body": []}}
    if not response_data:
        logger.info("Response data is empty for %s", request_id)
        return {"servicenow_response": {"body": []}}
    logger.info("Returning response with %d messages for %s", len(response_data), request_id)
    return {"servicenow_response": {"body": response_data}}

@app.get("/servicenow/responses/{request_id}")
async def get_servicenow_responses(request_id: str, acknowledge: bool = False, user: Optional[User] = Depends(get_current_user)):
    if not user:
        logger.error("Authentication failed")
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        return handle_responses(request_id, acknowledge)
    except Exception as e:
        logger.error("Error getting responses: %s", e)
        logger.error("Stack trace: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/poll/{request_id}")
async def poll_request(request_id: str, acknowledge: bool = False, user: Optional[User] = Depends(get_current_user)):
    if not user:
        logger.error("Authentication failed")
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        return handle_responses(request_id, acknowledge)
    except Exception as e:
        logger.error("Error polling request: %s", e)
        logger.error("Stack trace: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/debug/pending_responses")
async def debug_pending_responses(user: Optional[User] = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    logger.info("Current pending_responses: %s", json.dumps(pending_responses, indent=2))
    return {"pending_responses": pending_responses, "count": len(pending_responses)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
