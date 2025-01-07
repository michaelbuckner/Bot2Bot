// Generate a random session ID for this chat session
const sessionId = Math.random().toString(36).substring(7);

document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    const messageInput = document.getElementById('messageInput');
    const chatMessages = document.getElementById('chatMessages');
    const apiToggle = document.getElementById('apiToggle');
    const activeMode = document.getElementById('activeMode');
    const darkModeToggle = document.getElementById('darkModeToggle');
    const debugToggle = document.getElementById('debugToggle');
    const sendButton = document.querySelector('.send-button');

    // Update active mode display
    function updateActiveMode() {
        const mode = apiToggle.checked ? 'ServiceNow' : 'GPT';
        if (activeMode) {
            activeMode.textContent = `Current Mode: ${mode}`;
        }
    }

    // Initialize active mode
    updateActiveMode();

    // Listen for toggle changes
    apiToggle.addEventListener('change', updateActiveMode);

    // Set initial dark mode state
    function initializeDarkMode() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
            darkModeToggle.checked = savedTheme === 'dark';
        } else {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
            const isDark = prefersDark.matches;
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
            darkModeToggle.checked = isDark;
        }
    }

    // Handle dark mode toggle
    darkModeToggle.addEventListener('change', function() {
        const theme = this.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    });

    // Initialize dark mode
    initializeDarkMode();

    // Add click event listener for send button
    sendButton.addEventListener('click', sendMessage);

    // Handle enter key (send message) and shift+enter (new line)
    messageInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea as user types
    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    });

    // Helper to try parsing JSON, return null if invalid
    function tryParseJson(str) {
        try {
            return JSON.parse(str);
        } catch (err) {
            return null;
        }
    }

    async function sendMessage() {
        const message = messageInput.value.trim();
        const useServiceNow = apiToggle.checked;
        const isDebug = debugToggle.checked;
        
        if (message === '') return;
        
        // Add user message to chat
        addMessage(message, 'user-message');
        
        // Clear input and reset height
        messageInput.value = '';
        messageInput.style.height = 'auto';
        
        try {
            const requestPayload = {
                message: message,
                session_id: sessionId,
                use_servicenow: useServiceNow
            };

            // If debug mode is on, show the request payload
            if (isDebug) {
                addDebugMessage('Request Payload:', requestPayload);
            }

            // IMPORTANT: Make sure this URL is correct for your FastAPI server/port
            const response = await fetch('http://localhost:8000/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestPayload)
            });

            // Get raw text (to confirm it's really JSON)
            const rawText = await response.text();
            if (isDebug) {
                console.log('Raw response text:', rawText);
            }

            if (!response.ok) {
                throw new Error(rawText || 'Unknown error occurred');
            }

            // Parse the JSON
            const data = JSON.parse(rawText);

            // If debug mode is on, show the response payload
            if (isDebug) {
                addDebugMessage('Response Payload:', data);
            }

            if (useServiceNow) {
                // Check if we have a valid ServiceNow response structure
                if (data.servicenow_response && Array.isArray(data.servicenow_response.body)) {
                    // We iterate each item in the 'body'
                    data.servicenow_response.body.forEach(item => {
                        // If it's OutputText, we check whether 'value' is nested JSON
                        if (item.uiType === 'OutputText') {
                            const parsed = tryParseJson(item.value);
                            if (parsed && parsed.uiType === 'ActionMsg') {
                                // 'value' is actually JSON with an ActionMsg
                                if (parsed.actionType === 'System') {
                                    addMessage(parsed.message, 'bot-message system-message');
                                } else {
                                    // If you have other ActionMsg types, handle them
                                    addMessage(JSON.stringify(parsed), 'bot-message');
                                }
                            } else {
                                // Normal text
                                addMessage(item.value, 'bot-message');
                            }
                        } else if (item.uiType === 'ActionMsg' && item.actionType === 'System') {
                            addMessage(item.message, 'bot-message system-message');
                        } else {
                            // If desired, handle other UI types
                            addMessage(JSON.stringify(item), 'bot-message');
                        }
                    });
                } else {
                    // If no valid body found, show an error
                    addMessage('Received invalid response format from ServiceNow', 'bot-message error');
                    if (isDebug) {
                        addDebugMessage('Invalid ServiceNow Response:', data);
                    }
                }
            } else {
                // GPT scenario
                if (data.response) {
                    addMessage(data.response, 'bot-message');
                } else {
                    addMessage('No GPT response found', 'bot-message error');
                }
            }
        } catch (error) {
            console.error('Error:', error);
            const errorMessage = error.message || 'Sorry, there was an error processing your message.';
            addMessage(errorMessage, 'bot-message error');
            
            // If debug mode is on, show the error details
            if (isDebug) {
                addDebugMessage('Error Details:', error);
            }
        }
        
        // Scroll to bottom after adding message
        scrollToBottom();
    }

    function addDebugMessage(label, data) {
        const debugDiv = document.createElement('div');
        debugDiv.className = 'debug-message';
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'debug-label';
        labelSpan.textContent = label;
        debugDiv.appendChild(labelSpan);
        
        const pre = document.createElement('pre');
        try {
            // Handle Error objects specially
            if (data instanceof Error) {
                pre.textContent = `${data.name}: ${data.message}\n${data.stack || ''}`;
            } else {
                pre.textContent = JSON.stringify(data, null, 2);
            }
        } catch (e) {
            pre.textContent = String(data);
        }
        debugDiv.appendChild(pre);
        
        chatMessages.appendChild(debugDiv);
        scrollToBottom();
    }

    function addMessage(response, className) {
        console.log(response);
      
        // Grab the array from servicenow_response.body
        const bodyItems = response?.servicenow_response?.body ?? [];
        const collectedText = [];
      
        // Collect displayable text from body items
        bodyItems.forEach(item => {
          if (item.uiType === 'OutputText' && item.value) {
            try {
              // If it's JSON but an action message, skip displaying
              const parsed = JSON.parse(item.value);
              if (parsed.uiType !== 'ActionMsg') {
                collectedText.push(item.value);
              }
            } catch (e) {
              // Not JSON, treat as plain text
              collectedText.push(item.value);
            }
          }
        });
      
        // Create the message container
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${className}`;
      
        // If it's a bot message, add an icon
        if (className === 'bot-message') {
          messageDiv.setAttribute('data-source', apiToggle.checked ? 'servicenow' : 'gpt');
          const iconDiv = document.createElement('div');
          iconDiv.className = 'message-icon';
          iconDiv.innerHTML = apiToggle.checked
            ? `<img src="/static/servicenow-icon.png" width="24" height="24" alt="ServiceNow">`
            : `<svg ...>...</svg>`;
          messageDiv.appendChild(iconDiv);
        }
      
        // Build paragraphs from collected text
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        const paragraphs = collectedText.join('\n\n').split('\n\n').filter(Boolean);
      
        paragraphs.forEach((p, idx) => {
          const paragraph = document.createElement('p');
          paragraph.textContent = p;
          if (idx < paragraphs.length - 1) paragraph.style.marginBottom = '0.5rem';
          messageContent.appendChild(paragraph);
        });
      
        messageDiv.appendChild(messageContent);
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
      }
      

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Add click handlers for conversation starters
    document.querySelectorAll('.starter-button').forEach(button => {
        button.addEventListener('click', () => {
            const message = button.dataset.message;
            messageInput.value = message;
            sendMessage();
        });
    });
});
