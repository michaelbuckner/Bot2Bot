import React, { useState, useRef, useEffect } from 'react';
import ChatHeader from './ChatHeader';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import ConversationStarters from './ConversationStarters';

const ChatContainer = () => {
  const [messages, setMessages] = useState([]);
  const [isServiceNow, setIsServiceNow] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) return savedTheme === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [isDebug, setIsDebug] = useState(false);
  const sessionId = useRef(Math.random().toString(36).substring(7));
  const [isPolling, setIsPolling] = useState(false);
  const pollIntervalRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      setIsPolling(false);
    };
  }, []);

  const addMessage = (content, className) => {
    setMessages(prev => [...prev, { content, className, id: Date.now() }]);
  };

  const addDebugMessage = (label, data = '') => {
    if (isDebug) {
      const debugContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
      addMessage(`${label} ${debugContent}`, 'debug-message');
    }
  };

  const handleSendMessage = async (message) => {
    if (!message.trim()) return;

    // Add user message to chat
    addMessage(message, 'user-message');

    try {
      const requestPayload = {
        message: message,
        session_id: sessionId.current,
        use_servicenow: isServiceNow
      };

      if (isDebug) {
        addDebugMessage('Request Payload:', requestPayload);
      }

      const response = await fetch(`${window.location.origin}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(requestPayload)
      });

      const rawText = await response.text();
      if (isDebug) {
        addDebugMessage('Raw response text:', rawText);
      }

      if (!response.ok) {
        throw new Error(rawText || 'Unknown error occurred');
      }

      const data = JSON.parse(rawText);
      if (isDebug) {
        addDebugMessage('Response Payload:', data);
      }

      if (isServiceNow) {
        if (data.servicenow_response && data.servicenow_response.requestId) {
          const requestId = data.servicenow_response.requestId;
          let attempts = 0;
          const maxAttempts = 30;
          setIsPolling(true);

          if (isDebug) {
            addDebugMessage('Starting polling for request:', requestId);
          }
          
          const pollUrl = `${window.location.origin}/servicenow/responses/${requestId}`;
          if (isDebug) {
            addDebugMessage('Polling URL:', pollUrl);
          }
          
          const pollInterval = setInterval(async () => {
            if (!isPolling) {
              clearInterval(pollInterval);
              return;
            }

            if (attempts >= maxAttempts) {
              clearInterval(pollInterval);
              setIsPolling(false);
              addMessage('No more responses from ServiceNow', 'bot-message system-message');
              if (isDebug) {
                addDebugMessage('Polling timed out');
              }
              return;
            }

            attempts++;
            if (isDebug) {
              addDebugMessage(`Polling attempt ${attempts}/${maxAttempts} for request ${requestId}`);
            }

            try {
              const pollResponse = await fetch(pollUrl, {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include'
              });

              if (!pollResponse.ok) {
                throw new Error(`Poll failed: ${pollResponse.status}`);
              }

              const pollData = await pollResponse.json();
              if (isDebug) {
                addDebugMessage('Poll Response:', pollData);
              }

              if (pollData.servicenow_response && pollData.servicenow_response.body) {
                const messages = pollData.servicenow_response.body;
                let hasContent = false;

                for (const msg of messages) {
                  if (msg.uiType === 'ActionMsg') {
                    // Handle spinner messages
                    if (msg.actionType === 'StartSpinner') {
                      setIsLoading(true);
                    } else if (msg.actionType === 'EndSpinner') {
                      setIsLoading(false);
                    }
                  } else if (msg.uiType === 'OutputCard') {
                    try {
                      const cardData = JSON.parse(msg.data);
                      if (isDebug) {
                        addDebugMessage('Card data:', cardData);
                      }
                      
                      // Process each field
                      for (const field of cardData.fields) {
                        if (field.fieldLabel === 'Top Result:') {
                          hasContent = true;
                          addMessage(field.fieldValue, 'bot-message');
                          if (isDebug) {
                            addDebugMessage('Added message:', field.fieldValue);
                          }
                        } else if (field.fieldLabel.includes('KB')) {
                          // Add KB article link
                          const linkMessage = `Learn more: ${field.fieldValue}`;
                          addMessage(linkMessage, 'bot-message link-message');
                          if (isDebug) {
                            addDebugMessage('Added link:', linkMessage);
                          }
                        }
                      }
                    } catch (e) {
                      console.error('Failed to parse card data:', e);
                      if (isDebug) {
                        addDebugMessage('Error parsing card:', e);
                      }
                    }
                  } else if (msg.uiType === 'Picker') {
                    hasContent = true;
                    const pickerMessage = `${msg.label}\n${msg.options.map((opt, i) => `${i + 1}. ${opt.label}`).join('\n')}`;
                    addMessage(pickerMessage, 'bot-message picker-message');
                    if (isDebug) {
                      addDebugMessage('Added picker:', pickerMessage);
                    }
                  }
                }

                if (hasContent) {
                  // Acknowledge messages
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
                        addDebugMessage('Failed to acknowledge messages:', ackResponse.status);
                      }
                    } else if (isDebug) {
                      addDebugMessage('Messages acknowledged');
                    }
                  } catch (e) {
                    if (isDebug) {
                      addDebugMessage('Error acknowledging messages:', e);
                    }
                  }
                  
                  clearInterval(pollInterval);
                  setIsPolling(false);
                  if (isDebug) {
                    addDebugMessage('Polling complete');
                  }
                  return;
                }
              }
            } catch (error) {
              console.error('Error during polling:', error);
              if (isDebug) {
                addDebugMessage('Polling error:', error);
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
      addMessage(error.message || 'Error processing your message', 'bot-message error-message');
      if (isDebug) {
        addDebugMessage('Error:', error);
      }
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      if (response.ok) {
        window.location.href = '/login';
      } else {
        throw new Error('Logout failed');
      }
    } catch (error) {
      console.error('Logout error:', error);
      addMessage('Logout failed', 'error-message');
    }
  };

  return (
    <div className="chat-container">
      <ChatHeader 
        isServiceNow={isServiceNow}
        setIsServiceNow={setIsServiceNow}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        isDebug={isDebug}
        setIsDebug={setIsDebug}
        onLogout={handleLogout}
      />
      <ChatMessages messages={messages} isLoading={isLoading} />
      <ConversationStarters onSelect={handleSendMessage} />
      <ChatInput onSendMessage={handleSendMessage} />
    </div>
  );
};

export default ChatContainer;
