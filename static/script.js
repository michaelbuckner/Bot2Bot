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
            const response = await fetch('https://bot2bot.sliplane.app/chat', {
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
                if (data.servicenow_response && data.servicenow_response.requestId) {
                    const requestId = data.servicenow_response.requestId;
                    
                    // Start polling for responses
                    let attempts = 0;
                    const maxAttempts = 30; // Increase max attempts
                    const pollInterval = setInterval(async () => {
                        try {
                            if (attempts >= maxAttempts) {
                                clearInterval(pollInterval);
                                addMessage('No more responses from ServiceNow', 'bot-message system-message');
                                return;
                            }
                            
                            const pollResponse = await fetch(`/servicenow/responses/${requestId}`, {
                                method: 'GET',
                                headers: {
                                    'Content-Type': 'application/json',
                                }
                            });
                            
                            if (!pollResponse.ok) {
                                throw new Error(`Poll failed: ${pollResponse.statusText}`);
                            }
                            
                            const pollData = await pollResponse.json();
                            if (isDebug) {
                                addDebugMessage('Poll Response:', pollData);
                            }
                            
                            if (pollData.servicenow_response && pollData.servicenow_response.body) {
                                const messages = pollData.servicenow_response.body;
                                let hasContent = false;
                                
                                messages.forEach(item => {
                                    if (item.uiType === 'OutputCard') {
                                        hasContent = true;
                                        try {
                                            const cardData = JSON.parse(item.data);
                                            cardData.fields.forEach(field => {
                                                if (field.fieldLabel === 'Top Result:') {
                                                    addMessage(field.fieldValue, 'bot-message');
                                                }
                                            });
                                        } catch (e) {
                                            console.error('Failed to parse card data:', e);
                                            addMessage(JSON.stringify(item), 'bot-message');
                                        }
                                    } else if (item.uiType === 'Picker') {
                                        hasContent = true;
                                        // Handle picker if needed
                                        console.log('Picker received:', item);
                                    } else if (item.uiType === 'ActionMsg') {
                                        if (item.actionType === 'System') {
                                            addMessage(item.message, 'bot-message system-message');
                                        }
                                    }
                                });
                                
                                // Only stop polling if we got content messages
                                if (hasContent) {
                                    clearInterval(pollInterval);
                                }
                            }
                            
                            attempts++;
                        } catch (error) {
                            console.error('Polling error:', error);
                            if (isDebug) {
                                addDebugMessage('Polling Error:', error);
                            }
                            clearInterval(pollInterval);
                        }
                    }, 1000); // Poll every second
                    
                    // Show initial response if any
                    if (Array.isArray(data.servicenow_response.body)) {
                        data.servicenow_response.body.forEach(item => {
                            if (item.uiType === 'OutputText') {
                                const parsed = tryParseJson(item.value);
                                if (parsed && parsed.uiType === 'ActionMsg') {
                                    if (parsed.actionType === 'System') {
                                        addMessage(parsed.message, 'bot-message system-message');
                                    } else {
                                        addMessage(JSON.stringify(parsed), 'bot-message');
                                    }
                                } else {
                                    addMessage(item.value, 'bot-message');
                                }
                            } else if (item.uiType === 'ActionMsg' && item.actionType === 'System') {
                                addMessage(item.message, 'bot-message system-message');
                            } else {
                                addMessage(JSON.stringify(item), 'bot-message');
                            }
                        });
                    }
                } else {
                    // If no valid response found, show an error
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
        console.log('Adding message:', { response, className });
        
        // Skip StartConversation action messages
        if (typeof response === 'string') {
            try {
                const parsed = JSON.parse(response);
                if (parsed.uiType === 'ActionMsg' && parsed.actionType === 'StartConversation') {
                    console.log('Skipping StartConversation message');
                    return;
                }
            } catch (e) {
                // Not JSON, continue with normal message handling
            }
        }
      
        // Create the message container
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${className}`;
        console.log('Created message div with class:', messageDiv.className);
      
        // If it's a bot message, add an icon
        if (className === 'bot-message') {
          messageDiv.setAttribute('data-source', apiToggle.checked ? 'servicenow' : 'gpt');
          const iconDiv = document.createElement('div');
          iconDiv.className = 'message-icon';
          iconDiv.innerHTML = apiToggle.checked
            ? `<img src="/static/servicenow-icon.png" width="24" height="24" alt="ServiceNow">`
            : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>`;
          messageDiv.appendChild(iconDiv);
        }
      
        // Create the message content
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        // Handle the response based on its type
        if (typeof response === 'string') {
            const paragraph = document.createElement('p');
            paragraph.textContent = response;
            messageContent.appendChild(paragraph);
        } else if (response?.servicenow_response?.body) {
            // Handle ServiceNow response structure
            const bodyItems = response.servicenow_response.body;
            console.log('Processing ServiceNow body items:', bodyItems);
            
            bodyItems.forEach(item => {
                if (item.uiType === 'OutputText' && item.value) {
                    const paragraph = document.createElement('p');
                    paragraph.textContent = item.value;
                    messageContent.appendChild(paragraph);
                }
            });
        }
      
        messageDiv.appendChild(messageContent);
        console.log('Appending message to chat container:', messageDiv);
        
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            chatMessages.appendChild(messageDiv);
            console.log('Message appended successfully');
        } else {
            console.error('Chat messages container not found!');
        }
        
        scrollToBottom();
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Add logout functionality
    document.getElementById('logoutButton').addEventListener('click', async () => {
        try {
            const response = await fetch('/logout', {
                method: 'POST',
            });
            if (response.ok) {
                window.location.href = '/login';
            }
        } catch (error) {
            console.error('Logout failed:', error);
        }
    });

    // Add click handlers for conversation starters
    document.querySelectorAll('.starter-button').forEach(button => {
        button.addEventListener('click', () => {
            const message = button.dataset.message;
            messageInput.value = message;
            sendMessage();
        });
    });
});
