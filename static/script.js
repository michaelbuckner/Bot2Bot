// Generate a random session ID for this chat session
const sessionId = Math.random().toString(36).substring(7);
let isDebug = false; // Global isDebug flag

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

    // Update debug mode when toggle changes
    debugToggle.addEventListener('change', function() {
        isDebug = this.checked;
        if (isDebug) {
            addDebugMessage('Debug mode enabled');
        }
    });

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

    // Initialize debug mode
    isDebug = debugToggle.checked;

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

            // Get the current URL's origin
            const origin = window.location.origin;
            const chatUrl = `${origin}/chat`;

            // If debug mode is on, show the request payload
            if (isDebug) {
                addDebugMessage('Request Payload:', requestPayload);
                addDebugMessage('Chat URL:', chatUrl);
            }

            // Make the request to the chat endpoint
            const response = await fetch(chatUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',  // Include cookies for authentication
                body: JSON.stringify(requestPayload)
            });

            // Get raw text (to confirm it's really JSON)
            const rawText = await response.text();
            if (isDebug) {
                addDebugMessage('Raw response text:', rawText);
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
                    
                    if (isDebug) {
                        addDebugMessage('Starting polling for request:', requestId);
                    }
                    
                    // Start polling for responses
                    let attempts = 0;
                    const maxAttempts = 30; // 30 seconds timeout
                    
                    const pollInterval = setInterval(async () => {
                        try {
                            if (attempts >= maxAttempts) {
                                clearInterval(pollInterval);
                                addMessage('No more responses from ServiceNow', 'bot-message system-message');
                                if (isDebug) {
                                    addDebugMessage('Polling timed out after', maxAttempts, 'attempts');
                                }
                                return;
                            }
                            
                            attempts++;
                            if (isDebug) {
                                addDebugMessage(`Polling attempt ${attempts}/${maxAttempts} for request ${requestId}`);
                            }

                            // Get the current URL's origin
                            const pollUrl = `${origin}/servicenow/responses/${requestId}`;
                            
                            if (isDebug) {
                                addDebugMessage('Polling URL:', pollUrl);
                            }

                            const pollResponse = await fetch(pollUrl, {
                                method: 'GET',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                credentials: 'include'  // Include cookies for authentication
                            });
                            
                            if (!pollResponse.ok) {
                                if (isDebug) {
                                    addDebugMessage('Poll request failed:', {
                                        status: pollResponse.status,
                                        statusText: pollResponse.statusText
                                    });
                                }
                                throw new Error(`Poll failed: ${pollResponse.status} ${pollResponse.statusText}`);
                            }
                            
                            const pollData = await pollResponse.json();
                            if (isDebug) {
                                addDebugMessage('Poll Response:', pollData);
                            }
                            
                            if (pollData.servicenow_response && pollData.servicenow_response.body) {
                                const messages = pollData.servicenow_response.body;
                                if (isDebug) {
                                    addDebugMessage('Processing messages:', messages);
                                }
                                
                                let hasContent = false;
                                
                                for (const item of messages) {
                                    if (item.uiType === 'OutputCard') {
                                        hasContent = true;
                                        try {
                                            const cardData = JSON.parse(item.data);
                                            if (isDebug) {
                                                addDebugMessage('Card data:', cardData);
                                            }
                                            
                                            // Process each field
                                            for (const field of cardData.fields) {
                                                if (field.fieldLabel === 'Top Result:') {
                                                    // Remove the "Top Result:" prefix if present
                                                    const messageText = field.fieldValue.replace(/^Top Result:\s*/i, '');
                                                    addMessage(messageText, 'bot-message');
                                                    if (isDebug) {
                                                        addDebugMessage('Added top result message:', messageText);
                                                    }
                                                } else if (field.fieldLabel.includes('KB')) {
                                                    // Format the link as a clickable button
                                                    const linkMessage = `Learn more: ${field.fieldValue}`;
                                                    addMessage(linkMessage, 'bot-message link-message');
                                                    if (isDebug) {
                                                        addDebugMessage('Added link message:', linkMessage);
                                                    }
                                                }
                                            }
                                        } catch (e) {
                                            console.error('Failed to parse card data:', e);
                                            if (isDebug) {
                                                addDebugMessage('Failed to parse card data:', e);
                                                addDebugMessage('Raw card data:', item.data);
                                            }
                                            addMessage('Error: Failed to parse response', 'bot-message error-message');
                                        }
                                    } else if (item.uiType === 'Picker') {
                                        hasContent = true;
                                        // Format picker options as a list
                                        const pickerMessage = `${item.label}\n${item.options.map((opt, i) => `${i + 1}. ${opt.label}`).join('\n')}`;
                                        addMessage(pickerMessage, 'bot-message picker-message');
                                        if (isDebug) {
                                            addDebugMessage('Added picker message:', pickerMessage);
                                        }
                                    }
                                }
                                
                                if (hasContent) {
                                    // Acknowledge the messages
                                    try {
                                        const ackResponse = await fetch(`${pollUrl}?acknowledge=true`, {
                                            method: 'GET',
                                            headers: {
                                                'Content-Type': 'application/json',
                                            },
                                            credentials: 'include'
                                        });
                                        
                                        if (!ackResponse.ok) {
                                            if (isDebug) {
                                                addDebugMessage('Failed to acknowledge messages:', {
                                                    status: ackResponse.status,
                                                    statusText: ackResponse.statusText
                                                });
                                            }
                                        } else if (isDebug) {
                                            addDebugMessage('Successfully acknowledged messages');
                                        }
                                    } catch (e) {
                                        if (isDebug) {
                                            addDebugMessage('Error acknowledging messages:', e);
                                        }
                                    }
                                    
                                    clearInterval(pollInterval);
                                    if (isDebug) {
                                        addDebugMessage('Polling completed successfully');
                                    }
                                    return;
                                }
                            }
                        } catch (e) {
                            console.error('Error during polling:', e);
                            if (isDebug) {
                                addDebugMessage('Error during polling:', e);
                            }
                        }
                    }, 1000);
                } else {
                    if (isDebug) {
                        addDebugMessage('No requestId in response:', data);
                    }
                    addMessage('Error: No request ID received', 'bot-message error-message');
                }
            } else {
                // Handle GPT response
                if (data.response) {
                    addMessage(data.response, 'bot-message');
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

    function addDebugMessage(label, data = '') {
        if (!isDebug) return;

        const debugDiv = document.createElement('div');
        debugDiv.className = 'debug-message';
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'debug-label';
        labelSpan.textContent = label;
        debugDiv.appendChild(labelSpan);
        
        if (data) {
            const dataSpan = document.createElement('span');
            dataSpan.className = 'debug-data';
            if (typeof data === 'object') {
                dataSpan.textContent = JSON.stringify(data, null, 2);
            } else {
                dataSpan.textContent = data;
            }
            debugDiv.appendChild(document.createElement('br'));
            debugDiv.appendChild(dataSpan);
        }
        
        chatMessages.appendChild(debugDiv);
        scrollToBottom();
    }

    function addMessage(content, className) {
        if (!content) {
            console.error('Empty message content');
            return;
        }

        if (isDebug) {
            addDebugMessage('Adding message:', { content, className });
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = className;

        // Add source icon for bot messages
        if (className.includes('bot-message')) {
            const iconDiv = document.createElement('div');
            iconDiv.className = 'message-icon';
            
            // Set data-source attribute for styling
            messageDiv.setAttribute('data-source', apiToggle.checked ? 'servicenow' : 'gpt');
            
            // Add appropriate icon
            if (apiToggle.checked) {
                iconDiv.innerHTML = '<img src="/static/servicenow-icon.png" alt="ServiceNow" width="24" height="24">';
            } else {
                iconDiv.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>`;
            }
            messageDiv.appendChild(iconDiv);
        }

        // Create message content
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        if (className.includes('link-message')) {
            // Make link messages clickable
            const link = document.createElement('a');
            link.href = content.replace('Learn more: ', '');
            link.target = '_blank';
            link.textContent = content;
            messageContent.appendChild(link);
        } else if (className.includes('picker-message')) {
            // Format picker messages with proper line breaks
            messageContent.style.whiteSpace = 'pre-line';
            messageContent.textContent = content;
        } else {
            // Regular message
            messageContent.textContent = content;
        }

        messageDiv.appendChild(messageContent);
        chatMessages.appendChild(messageDiv);
        scrollToBottom();

        if (isDebug) {
            addDebugMessage('Message added successfully');
        }
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
