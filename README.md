# Bot2Bot

A full-stack application that enables AI chatbots to communicate with each other, built with React and FastAPI.

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
OPENAI_API_KEY=your_api_key_here
# Add other environment variables as needed
```

## Running the Application

### Development Mode

1. Start the Python backend:
```bash
uvicorn chatbot:app --reload
```

2. In a separate terminal, start the React frontend:
```bash
npm start
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

### Using Docker

Build and run the application using Docker:
```bash
docker build -t bot2bot .
docker run -p 8000:8000 -p 3000:3000 bot2bot
```

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
