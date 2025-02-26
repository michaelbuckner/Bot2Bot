import pytest
from unittest.mock import patch, MagicMock
from fastapi import Request, Response
from fastapi.responses import RedirectResponse, FileResponse
import json
import uuid
import os
import asyncio
import httpx

# Set mock environment variables
os.environ['OPENAI_API_KEY'] = 'test-key'
os.environ['SERVICENOW_INSTANCE'] = 'test-instance'
os.environ['SERVICENOW_USERNAME'] = 'test-username'
os.environ['SERVICENOW_PASSWORD'] = 'test-password'
os.environ['SERVICENOW_TOKEN'] = 'test-token'

# Import after setting mock environment variables
from chatbot import app, get_gpt_response, ServiceNowAPI, ChatbotAPI, get_current_user

# Configure pytest-asyncio
pytest.asyncio_fixture_loop_scope = "function"

@pytest.fixture
def event_loop():
    """Create an instance of the default event loop for each test case."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture
async def client():
    """Create a TestClient instance."""
    # Reset any previous overrides
    app.dependency_overrides = {}
    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        yield client

@pytest.fixture
async def authenticated_client(mock_users, mock_sessions, mock_user):
    """Create an authenticated TestClient instance."""
    sessions, _ = mock_sessions
    
    # Set up the authenticated user
    mock_user_instance = mock_user()
    
    # Override the get_current_user dependency
    async def override_get_current_user(request: Request):
        return mock_user_instance
    
    app.dependency_overrides[get_current_user] = override_get_current_user
    
    # Create a new client
    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        # Login to get a session
        response = await client.post(
            "/login",
            json={"username": "test@example.com", "password": "test_password"}
        )
        assert response.status_code == 200
        session_id = response.cookies["session_id"]
        sessions[session_id] = mock_user_instance
        
        # Set the session cookie
        client.cookies.set("session_id", session_id)
        yield client

@pytest.fixture(autouse=True)
def mock_langsmith():
    # Set LANGSMITH_API_KEY to ensure LangSmith is "enabled" for tests
    os.environ['LANGSMITH_API_KEY'] = 'test-langsmith-key'
    
    # Mock the conditional imports and usage
    with patch('chatbot.use_langsmith', True), \
         patch('langsmith.Client'), \
         patch('langsmith.wrappers.wrap_openai', return_value=lambda x: x), \
         patch('langsmith.traceable', return_value=lambda f: f), \
         patch('chatbot.traceable', return_value=lambda f: f):
        yield

@pytest.fixture(autouse=True)
def mock_responses(mock_sessions):
    sessions, _ = mock_sessions
    
    def mock_redirect_init(*args, **kwargs):
        if len(args) > 0 and isinstance(args[0], str):
            url = args[0]
        else:
            url = kwargs.get("url", "/login")
        return RedirectResponse(url=url, status_code=307)

    def mock_file_init(*args, **kwargs):
        # Handle both positional and keyword arguments
        path = args[0] if args else kwargs.get('path')
        if path and path.endswith('index.html'):
            return Response(
                content="mocked index.html content",
                media_type="text/html",
                status_code=200
            )
        raise FileNotFoundError(f"File not found: {path}")

    def mock_template_response(*args, **kwargs):
        return Response(
            content="mocked template",
            media_type="text/html",
            status_code=200
        )

    # Mock FastAPI security
    mock_security = MagicMock()
    mock_security.return_value = MagicMock()

    # Mock templates
    mock_templates = MagicMock()
    mock_templates.TemplateResponse.side_effect = mock_template_response

    with patch('fastapi.responses.FileResponse', side_effect=mock_file_init) as mock_file, \
         patch('fastapi.responses.RedirectResponse', side_effect=mock_redirect_init) as mock_redirect, \
         patch('chatbot.RedirectResponse', side_effect=mock_redirect_init), \
         patch('chatbot.FileResponse', side_effect=mock_file_init), \
         patch('fastapi.security.HTTPBasic', return_value=mock_security), \
         patch('fastapi.security.HTTPBasicCredentials', return_value=MagicMock()), \
         patch('fastapi.security.HTTPBearer', return_value=mock_security), \
         patch('chatbot.templates', mock_templates):
        yield mock_file, mock_redirect

@pytest.fixture(autouse=True)
def mock_sessions():
    sessions = {}
    pending = {}
    with patch('chatbot.sessions', sessions), \
         patch('chatbot.pending_responses', pending):
        yield sessions, pending

@pytest.fixture
def mock_users():
    test_users = {
        "test@example.com": {
            "password": "test_password",
            "name": "Test User"
        }
    }
    with patch('builtins.open', create=True) as mock_file:
        mock_file.return_value.__enter__.return_value.read.return_value = json.dumps(test_users)
        yield test_users

@pytest.fixture
def mock_openai():
    mock_response = MagicMock()
    mock_response.choices = [MagicMock(message=MagicMock(content="Test GPT response"))]
    
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_response
    
    with patch('openai.OpenAI', return_value=mock_client), \
         patch('chatbot.openai_client', mock_client), \
         patch('chatbot.client', mock_client), \
         patch('chatbot.get_gpt_response', return_value="Test GPT response"):
        yield mock_client.chat.completions.create

@pytest.fixture
def mock_servicenow():
    with patch.object(ServiceNowAPI, 'send_message_to_va') as mock:
        mock.return_value = {
            "status": "success",
            "requestId": str(uuid.uuid4())
        }
        yield mock

@pytest.fixture(autouse=True)
def mock_user():
    with patch('chatbot.User') as mock_user_class:
        mock_user = MagicMock()
        mock_user.username = "test@example.com"
        mock_user_class.return_value = mock_user
        mock_user_class.model_validate = lambda x: mock_user
        yield mock_user_class

@pytest.mark.asyncio
async def test_home_route_redirect_when_not_authenticated(client):
    """Test that home route redirects to login when not authenticated"""
    # Reset any previous overrides
    app.dependency_overrides = {}
    
    # Override get_current_user to always return None
    async def override_get_current_user(request: Request):
        return None
    
    app.dependency_overrides[get_current_user] = override_get_current_user
    
    response = await client.get("/")
    assert response.status_code == 307
    assert response.headers["location"] == "/login"
    
    # Clean up
    app.dependency_overrides = {}

@pytest.mark.asyncio
async def test_home_route_authenticated(authenticated_client):
    """Test that home route returns index.html when authenticated"""
    response = await authenticated_client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/html; charset=utf-8"

@pytest.mark.asyncio
async def test_logout(authenticated_client, mock_sessions):
    """Test logout functionality"""
    sessions, _ = mock_sessions
    
    # First verify we have a valid session
    response = await authenticated_client.get("/")
    assert response.status_code == 200  # Should be authenticated
    
    session_id = authenticated_client.cookies.get("session_id")
    assert session_id is not None
    assert session_id in sessions  # Verify session exists before logout
    
    # Send logout request
    response = await authenticated_client.post("/logout")
    assert response.status_code == 307
    assert response.headers["location"] == "/login"
    
    # Verify session was removed
    assert session_id not in sessions
    
    # Override get_current_user to simulate logged out state
    async def override_get_current_user(request: Request):
        return None
    
    app.dependency_overrides[get_current_user] = override_get_current_user
    
    # Verify we can't access protected routes anymore
    response = await authenticated_client.get("/")
    assert response.status_code == 307  # Should redirect to login
    assert response.headers["location"] == "/login"

@pytest.mark.asyncio
async def test_login_success(client):
    """Test successful login"""
    response = await client.post(
        "/login",
        json={"username": "test@example.com", "password": "test_password"}
    )
    assert response.status_code == 200
    assert "session_id" in response.cookies

@pytest.mark.asyncio
async def test_login_failure(client):
    """Test failed login"""
    response = await client.post(
        "/login",
        json={"username": "test@example.com", "password": "wrong_password"}
    )
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_chat_gpt(authenticated_client, mock_openai):
    """Test chat with GPT"""
    response = await authenticated_client.post(
        "/chat",
        json={"message": "test message", "session_id": "test-session", "use_servicenow": False}
    )
    assert response.status_code == 200
    assert response.json()["response"] == "Test GPT response"

@pytest.mark.asyncio
async def test_chat_servicenow(authenticated_client, mock_servicenow):
    """Test chat with ServiceNow"""
    response = await authenticated_client.post(
        "/chat",
        json={"message": "test message", "session_id": "test-session", "use_servicenow": True}
    )
    assert response.status_code == 200
    assert "servicenow_response" in response.json()
    assert "requestId" in response.json()["servicenow_response"]

def test_chatbot_api():
    """Test ChatbotAPI class"""
    api = ChatbotAPI()
    request_id = str(uuid.uuid4())
    test_messages = [
        {
            "uiType": "OutputCard",
            "data": json.dumps({"test": "data"})
        }
    ]
    
    # Test storing messages
    stored = api.store_messages(request_id, test_messages)
    assert stored == test_messages
    
    # Test getting messages
    retrieved = api.get_messages(request_id)
    assert retrieved == test_messages
    
    # Test getting non-existent messages
    empty = api.get_messages("non-existent")
    assert empty == []

@pytest.mark.asyncio
async def test_servicenow_callback(authenticated_client, mock_sessions):
    """Test ServiceNow callback endpoint"""
    _, pending_responses = mock_sessions
    request_id = str(uuid.uuid4())
    callback_data = {
        "requestId": request_id,
        "body": [
            {
                "uiType": "OutputCard",
                "group": "DefaultOutputCard",
                "templateName": "Card",
                "data": json.dumps({
                    "title": "Test Response",
                    "fields": [
                        {
                            "fieldLabel": "Test Field",
                            "fieldValue": "Test Value"
                        }
                    ]
                })
            }
        ],
        "clientSessionId": str(uuid.uuid4())
    }
    
    response = await authenticated_client.post(
        "/servicenow/callback",
        json=callback_data
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert request_id in pending_responses

@pytest.mark.asyncio
async def test_get_servicenow_responses(authenticated_client, mock_sessions):
    """Test getting ServiceNow responses"""
    _, pending_responses = mock_sessions
    request_id = str(uuid.uuid4())
    
    # Add test response to pending_responses
    test_response = [{
        "uiType": "OutputCard",
        "data": json.dumps({"test": "data"})
    }]
    pending_responses[request_id] = test_response
    
    # First get without acknowledge
    response = await authenticated_client.get(f"/servicenow/responses/{request_id}")
    assert response.status_code == 200
    assert "servicenow_response" in response.json()
    assert request_id in pending_responses
    
    # Then get with acknowledge
    response = await authenticated_client.get(f"/servicenow/responses/{request_id}?acknowledge=true")
    assert response.status_code == 200
    assert "servicenow_response" in response.json()
    assert request_id not in pending_responses

@pytest.mark.asyncio
async def test_poll_request(authenticated_client, mock_sessions):
    """Test polling endpoint"""
    _, pending_responses = mock_sessions
    request_id = str(uuid.uuid4())
    
    # Add test response to pending_responses
    test_response = [{
        "uiType": "OutputCard",
        "data": json.dumps({"test": "data"})
    }]
    pending_responses[request_id] = test_response
    
    response = await authenticated_client.get(f"/poll/{request_id}")
    assert response.status_code == 200
    assert "servicenow_response" in response.json()
    assert response.json()["servicenow_response"]["body"] == test_response

@pytest.mark.asyncio
async def test_debug_pending_responses(authenticated_client, mock_sessions):
    """Test debug endpoint for pending responses"""
    _, pending_responses = mock_sessions
    
    # Add test responses
    request_id1 = str(uuid.uuid4())
    request_id2 = str(uuid.uuid4())
    test_response = [{
        "uiType": "OutputCard",
        "data": json.dumps({"test": "data"})
    }]
    pending_responses[request_id1] = test_response
    pending_responses[request_id2] = test_response
    
    response = await authenticated_client.get("/debug/pending_responses")
    assert response.status_code == 200
    assert "pending_responses" in response.json()
    assert "count" in response.json()
    assert response.json()["count"] == 2
    assert request_id1 in response.json()["pending_responses"]
    assert request_id2 in response.json()["pending_responses"]

@pytest.mark.asyncio
async def test_unauthenticated_access(client):
    """Test that endpoints require authentication"""
    endpoints = [
        ("/chat", "POST"),
        ("/servicenow/responses/test-id", "GET"),
        ("/poll/test-id", "GET"),
        ("/debug/pending_responses", "GET")
    ]
    
    for endpoint, method in endpoints:
        if method == "GET":
            response = await client.get(endpoint)
        else:
            response = await client.post(
                endpoint,
                json={"message": "test", "session_id": "test"}
            )
        assert response.status_code == 401
