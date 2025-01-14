# Bot2Bot

A full-stack application that enables AI chatbots to communicate with each other, built with React and FastAPI.

<img src="https://github.com/user-attachments/assets/d1a41094-fb41-4f0a-9512-03198f06cc62" alt="image" width="500">


## Features

- Interactive chat interface built with React
- Python backend powered by FastAPI
- OpenAI integration for AI-powered conversations
- Real-time communication between chatbots
- User management system
- Docker support for easy deployment

## Prerequisites

- Node.js (v18 or higher)
- Python (3.8 or higher)
- Docker (optional)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/Bot2Bot.git
cd Bot2Bot
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Install Node.js dependencies:
```bash
npm install
```

4. Set up environment variables:
Create a `.env` file in the root directory and add your configuration:
```
OPENAI_API_KEY=
SERVICENOW_INSTANCE=
SERVICENOW_PASSWORD=
SERVICENOW_TOKEN=
SERVICENOW_USERNAME=
CALLBACK_PASSWORD=
CALLBACK_USERNAME=
LANGSMITH_TRACING=
LANGSMITH_ENDPOINT=
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=
# Add other environment variables as needed
```

## Running the Application

### Using Docker

Build and run the application using Docker:
```bash
docker build -t bot2bot .
docker run -p 8000:8000 bot2bot
```

## ServiceNow Configuration

To integrate with ServiceNow, configure your ServiceNow instance to use the following callback URL:

```
http://your-bot2bot-domain/servicenow/callback
```

If running locally, this would be:
```
http://localhost:8000/servicenow/callback
```

Make sure to:
1. Configure this URL in your ServiceNow instance settings
2. Use the credentials specified in your `.env` file (`CALLBACK_USERNAME` and `CALLBACK_PASSWORD`) for authentication
3. Ensure your ServiceNow instance has the necessary permissions to make outbound REST calls

## Project Structure

- `/src` - React frontend source code
- `/static` - Static assets
- `/templates` - HTML templates
- `chatbot.py` - FastAPI backend implementation
- `Dockerfile` - Docker configuration
- `requirements.txt` - Python dependencies
- `package.json` - Node.js dependencies

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- OpenAI for their powerful AI models
- FastAPI for the efficient Python web framework
- React for the frontend framework
