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
  const chatMessages = useRef(null);

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
    if (!content) {
      console.error('Empty message content');
      return;
    }

    if (isDebug) {
      addDebugMessage('Adding message:', { content, className });
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${className}`;

    // Add source icon for bot messages
    if (className.includes('bot-message')) {
      const iconDiv = document.createElement('div');
      iconDiv.className = 'message-icon';
      
      // Set data-source attribute for styling
      messageDiv.setAttribute('data-source', isServiceNow ? 'servicenow' : 'gpt');
      
      // Add appropriate icon
      if (isServiceNow) {
        iconDiv.innerHTML = '<img src="/static/servicenow-icon.png" alt="ServiceNow" width="24" height="24">';
      } else {
        iconDiv.innerHTML = '<img src="/static/openai.png" alt="OpenAI" width="24" height="24">';
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
    chatMessages.current.appendChild(messageDiv);
    scrollToBottom();

    if (isDebug) {
      addDebugMessage('Message added successfully');
    }
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
    const userMessage = { text: message, type: 'user-message' };
    setMessages(prev => [...prev, userMessage]);

    try {
      setIsLoading(true);
      const response = await fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message,
          session_id: sessionId.current,
          use_servicenow: true
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const rawText = await response.text();
      if (isDebug) {
        addDebugMessage('Raw response text:', rawText);
      }

      const responseData = JSON.parse(rawText);
      if (isDebug) {
        addDebugMessage('Response Payload:', responseData);
      }

      // Start polling if we have a ServiceNow request ID
      if (responseData.servicenow_response?.requestId) {
        const requestId = responseData.servicenow_response.requestId;
        if (isDebug) addDebugMessage('Starting polling for request:', requestId);

        // Set up polling
        const origin = window.location.origin;
        const pollUrl = `${origin}/servicenow/responses/${requestId}`;
        
        if (isDebug) {
          addDebugMessage('Polling URL:', pollUrl);
        }

        setIsPolling(true);
        let attempts = 0;
        const maxAttempts = 60;

        const pollInterval = setInterval(async () => {
          if (!isPolling) {
            if (isDebug) addDebugMessage('Polling stopped: isPolling is false');
            clearInterval(pollInterval);
            return;
          }

          if (attempts >= maxAttempts) {
            if (isDebug) addDebugMessage('Polling stopped: max attempts reached');
            clearInterval(pollInterval);
            setIsPolling(false);
            addMessage('No more responses from ServiceNow', 'bot-message system-message');
            return;
          }

          attempts++;
          if (isDebug) {
            addDebugMessage(`Polling attempt ${attempts}/${maxAttempts} for request ${requestId}`);
          }

          try {
            if (isDebug) addDebugMessage('Sending poll request to:', pollUrl);
            const pollResponse = await fetch(pollUrl, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include'  // Include cookies for authentication
            });

            if (!pollResponse.ok) {
              if (isDebug) addDebugMessage('Poll request failed:', pollResponse.status);
              if (pollResponse.status === 401) {
                // Handle authentication error
                if (isDebug) addDebugMessage('Authentication failed, redirecting to login');
                window.location.href = '/login';
                return;
              }
              throw new Error(`Poll failed: ${pollResponse.status}`);
            }

            const pollText = await pollResponse.text();
            if (isDebug) {
              addDebugMessage('Poll Response Text:', pollText);
            }

            const pollData = JSON.parse(pollText);
            if (isDebug) {
              addDebugMessage('Poll Response Data:', pollData);
              addDebugMessage('Response body:', pollData.servicenow_response?.body || 'No body');
            }

            if (pollData.servicenow_response && pollData.servicenow_response.body) {
              const messages = pollData.servicenow_response.body;
              let hasContent = false;
              let hasSpinner = false;

              if (isDebug) addDebugMessage(`Processing ${messages.length} messages`);

              for (const msg of messages) {
                if (isDebug) {
                  addDebugMessage('Processing message:', {
                    type: msg.uiType,
                    action: msg.actionType,
                    data: msg.data || msg.message || 'No data'
                  });
                }

                switch (msg.uiType) {
                  case 'ActionMsg':
                    switch (msg.actionType) {
                      case 'StartSpinner':
                        hasSpinner = true;
                        setIsLoading(true);
                        if (isDebug) addDebugMessage('Started spinner');
                        break;
                      case 'EndSpinner':
                        hasSpinner = true;
                        setIsLoading(false);
                        if (isDebug) addDebugMessage('Ended spinner');
                        break;
                      case 'System':
                        hasContent = true;
                        addMessage(msg.message, 'bot-message system-message');
                        if (isDebug) addDebugMessage('Added system message:', msg.message);
                        break;
                      case 'StartConversation':
                        if (isDebug) addDebugMessage('Started conversation:', msg.conversationId);
                        break;
                      default:
                        if (msg.message) {
                          hasContent = true;
                          addMessage(msg.message, 'bot-message');
                          if (isDebug) addDebugMessage('Added message:', msg.message);
                        }
                        break;
                    }
                    break;

                  case 'OutputCard':
                    hasContent = true;  // Mark as content even if parsing fails
                    try {
                      const cardData = JSON.parse(msg.data);
                      if (isDebug) addDebugMessage('Card data:', cardData);
                      
                      for (const field of cardData.fields) {
                        if (isDebug) addDebugMessage('Processing field:', field);
                        if (field.fieldLabel === 'Top Result:') {
                          addMessage(field.fieldValue, 'bot-message');
                          if (isDebug) addDebugMessage('Added message:', field.fieldValue);
                        } else if (field.fieldLabel.includes('KB')) {
                          const linkMessage = `Learn more: ${field.fieldValue}`;
                          addMessage(linkMessage, 'bot-message link-message');
                          if (isDebug) addDebugMessage('Added link:', linkMessage);
                        }
                      }
                    } catch (e) {
                      console.error('Failed to parse card data:', e);
                      if (isDebug) {
                        addDebugMessage('Error parsing card:', e.message);
                        addDebugMessage('Raw card data:', msg.data);
                      }
                    }
                    break;

                  case 'Picker':
                    hasContent = true;
                    const pickerMessage = `${msg.label}\n${msg.options.map((opt, i) => `${i + 1}. ${opt.label}`).join('\n')}`;
                    addMessage(pickerMessage, 'bot-message picker-message');
                    if (isDebug) addDebugMessage('Added picker:', pickerMessage);
                    break;
                }
              }

              if (isDebug) {
                addDebugMessage('Message processing complete:', {
                  hasContent,
                  hasSpinner,
                  messageCount: messages.length
                });
              }

              // Acknowledge messages if we have content or spinners
              if (hasContent || hasSpinner) {
                try {
                  if (isDebug) addDebugMessage('Acknowledging messages');
                  const ackResponse = await fetch(`${pollUrl}?acknowledge=true`, {
                    method: 'GET',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    credentials: 'include'
                  });
                  
                  if (!ackResponse.ok) {
                    if (isDebug) addDebugMessage('Failed to acknowledge messages:', ackResponse.status);
                  } else if (isDebug) addDebugMessage('Messages acknowledged');
                } catch (e) {
                  if (isDebug) addDebugMessage('Error acknowledging messages:', e.message);
                }
              } else if (isDebug) {
                addDebugMessage('No messages to acknowledge');
              }

              // Stop polling if we have content
              if (hasContent) {
                if (isDebug) addDebugMessage('Stopping poll: content received');
                clearInterval(pollInterval);
                setIsPolling(false);
                return;
              } else if (isDebug) {
                addDebugMessage('Continuing poll: no content yet');
              }
            } else if (isDebug) {
              addDebugMessage('No messages in response');
            }
          } catch (error) {
            console.error('Error during polling:', error);
            if (isDebug) {
              addDebugMessage('Polling error:', error.message);
              addDebugMessage('Error stack:', error.stack);
            }
          }
        }, 1000);
      } else {
        // Handle GPT response
        if (responseData.response) {
          addMessage(responseData.response, 'bot-message');
        }
      }
    } catch (error) {
      console.error('Error:', error);
      if (isDebug) {
        addDebugMessage('Error:', error);
      }
    } finally {
      setIsLoading(false);
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

  const scrollToBottom = () => {
    const chatMessagesDiv = chatMessages.current;
    if (chatMessagesDiv) {
      chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
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
      <ChatMessages ref={chatMessages} messages={messages} isLoading={isLoading} />
      <ConversationStarters onSelect={handleSendMessage} />
      <ChatInput onSendMessage={handleSendMessage} />
    </div>
  );
};

export default ChatContainer;
