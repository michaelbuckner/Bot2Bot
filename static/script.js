 // Generate random session ID
const sessionId = Math.random().toString(36).substring(7);

document.addEventListener('DOMContentLoaded', function() {
  const messageInput = document.getElementById('messageInput');
  const chatMessages = document.getElementById('chatMessages');
  const apiToggle = document.getElementById('apiToggle');
  const activeMode = document.getElementById('activeMode');
  const darkModeToggle = document.getElementById('darkModeToggle');
  const debugToggle = document.getElementById('debugToggle');
  const sendButton = document.querySelector('.send-button');

  function updateActiveMode() {
    const mode = apiToggle.checked ? 'ServiceNow' : 'GPT';
    if (activeMode) {
      activeMode.textContent = `Current Mode: ${mode}`;
    }
  }
  updateActiveMode();
  apiToggle.addEventListener('change', updateActiveMode);

  // Initialize dark mode
  function initializeDarkMode() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
      darkModeToggle.checked = (savedTheme === 'dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
      const isDark = prefersDark.matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      darkModeToggle.checked = isDark;
    }
  }
  initializeDarkMode();

  darkModeToggle.addEventListener('change', function() {
    const theme = this.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  });

  sendButton.addEventListener('click', sendMessage);

  messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
  });

  async function sendMessage() {
    const message = messageInput.value.trim();
    const useServiceNow = apiToggle.checked;
    const isDebug = debugToggle.checked;

    if (!message) return;

    addMessage(message, 'user-message');
    messageInput.value = '';
    messageInput.style.height = 'auto';

    try {
      const requestPayload = {
        message: message,
        session_id: sessionId,
        use_servicenow: useServiceNow
      };

      if (isDebug) {
        addDebugMessage('Request Payload:', requestPayload);
      }

      // Change this if your FastAPI is at a different URL/port
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Unknown error occurred');
      }

      const data = await response.json();
      if (isDebug) {
        addDebugMessage('Response Payload:', data);
      }

      if (useServiceNow) {
        // Get the response, preferring servicenow_response if available
        const snRes = data.servicenow_response || data;
        
        if (isDebug) {
          console.log('Raw ServiceNow response:', snRes);
          addDebugMessage('Raw ServiceNow Response:', snRes);
        }

        // Handle string responses
        if (typeof snRes === 'string') {
          addMessage(snRes, 'bot-message');
          return;
        }

        // Handle non-object responses
        if (!snRes || typeof snRes !== 'object') {
          addMessage('Received invalid response from ServiceNow', 'bot-message error');
          if (isDebug) {
            addDebugMessage('Invalid response type:', typeof snRes);
          }
          return;
        }

        // Handle missing body
        if (!snRes.body) {
          addMessage(JSON.stringify(snRes), 'bot-message');
          if (isDebug) {
            addDebugMessage('Response missing body:', snRes);
          }
          return;
        }

        // Handle non-array body
        if (!Array.isArray(snRes.body)) {
          addMessage(JSON.stringify(snRes.body), 'bot-message');
          if (isDebug) {
            addDebugMessage('Body is not an array:', snRes.body);
          }
          return;
        }

        // Process each item in the body array
        let hasProcessedMessage = false;
        snRes.body.forEach(item => {
          if (!item || typeof item !== 'object') {
            addMessage(String(item), 'bot-message');
            hasProcessedMessage = true;
            return;
          }

          try {
            if (item.uiType === 'OutputText') {
              if (item.value) {
                // Try to parse the value as JSON if it looks like JSON
                if (typeof item.value === 'string' && item.value.trim().startsWith('{')) {
                  try {
                    const parsedValue = JSON.parse(item.value);
                    if (parsedValue.uiType === 'ActionMsg') {
                      if (parsedValue.actionType === 'System' && parsedValue.message) {
                        addMessage(parsedValue.message, 'bot-message system-message');
                        hasProcessedMessage = true;
                      }
                      // Skip other action messages like StartConversation
                      return;
                    }
                  } catch (jsonError) {
                    // If parsing fails, treat it as a regular string
                    addMessage(item.value, 'bot-message');
                    hasProcessedMessage = true;
                  }
                } else {
                  // Regular string value
                  addMessage(item.value, 'bot-message');
                  hasProcessedMessage = true;
                }
              }
            } else if (item.uiType === 'ActionMsg' && item.actionType === 'System' && item.message) {
              addMessage(item.message, 'bot-message system-message');
              hasProcessedMessage = true;
            }
          } catch (itemError) {
            console.error('Error processing response item:', itemError, item);
            if (isDebug) {
              addDebugMessage('Error processing item:', { error: itemError.message, item });
            }
          }
        });

        // Handle case where no messages were processed
        if (!hasProcessedMessage) {
          addMessage('No readable message content in response', 'bot-message warning');
          if (isDebug) {
            addDebugMessage('Response body with no processable messages:', snRes.body);
          }
        }
      } else {
        // GPT response
        if (data.response) {
          addMessage(data.response, 'bot-message');
        } else {
          addMessage('No GPT response found', 'bot-message error');
        }
      }
    } catch (error) {
      console.error('Error:', error);
      addMessage(error.message || 'An error occurred', 'bot-message error');
      if (isDebug) {
        addDebugMessage('Error Details:', error);
      }
    }

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
    if (data instanceof Error) {
      pre.textContent = `${data.name}: ${data.message}\n${data.stack || ''}`;
    } else {
      pre.textContent = JSON.stringify(data, null, 2);
    }
    debugDiv.appendChild(pre);

    chatMessages.appendChild(debugDiv);
    scrollToBottom();
  }

  function addMessage(message, className) {
    if (!message) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${className}`;

    if (className.includes('bot-message')) {
      messageDiv.setAttribute('data-source', apiToggle.checked ? 'servicenow' : 'gpt');
      const iconDiv = document.createElement('div');
      iconDiv.className = 'message-icon';

      if (apiToggle.checked) {
        // ServiceNow icon
        iconDiv.innerHTML = `<img src="/static/servicenow-icon.png" width="24" height="24" alt="ServiceNow">`;
      } else {
        // OpenAI icon (GPT)
        iconDiv.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7782-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
        </svg>`;
      }
      messageDiv.appendChild(iconDiv);
    }

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    if (typeof message === 'string') {
      const paragraph = document.createElement('p');
      paragraph.textContent = message;
      messageContent.appendChild(paragraph);
    } else {
      const paragraph = document.createElement('p');
      paragraph.textContent = JSON.stringify(message, null, 2);
      messageContent.appendChild(paragraph);
    }

    messageDiv.appendChild(messageContent);
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  document.querySelectorAll('.starter-button').forEach(button => {
    button.addEventListener('click', () => {
      const message = button.dataset.message;
      messageInput.value = message;
      sendMessage();
    });
  });
});