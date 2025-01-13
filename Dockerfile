# Stage 1: Build React frontend
FROM node:18 AS frontend-build

WORKDIR /app/frontend

# Copy package files
COPY package.json package-lock.json ./
RUN npm install

# Copy frontend source code
COPY public/ public/
COPY src/ src/

# Build React app
RUN npm run build

# Stage 2: Python backend with React static files
FROM python:3.11-slim

WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the Python backend
COPY chatbot.py .
COPY users.json .
COPY .env .
COPY templates/ templates/
COPY templates/static/* /app/static/

# Copy React build files from frontend stage
COPY --from=frontend-build /app/frontend/build/* /app/static/

# Expose the port the app runs on
EXPOSE 8000

# Environment variable for Flask
ENV FLASK_APP=chatbot.py
ENV FLASK_ENV=production

# Command to run the application
CMD ["python", "chatbot.py"]
