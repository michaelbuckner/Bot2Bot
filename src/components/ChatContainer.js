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
  const chatMessagesRef = useRef(null);

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

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [messages]);

  const addMessage = (content, className = 'bot-message') => {
    if (!content) {
      console.error('Empty message content');
      return;
    }
    setMessages(prev => [...prev, { text: content, type: className, isServiceNow }]);
  };

  const addDebugMessage = (label, data = '') => {
    if (!isDebug) return;
    const debugContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    addMessage(`${label} ${debugContent}`, 'debug-message');
  };

  const handleSendMessage = async (message) => {
    if (!message.trim()) return;

    // Add user message to chat
    setMessages(prev => [...prev, { text: message, type: 'user-message' }]);

    try {
      setIsLoading(true);
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          session_id: sessionId.current,
          use_servicenow: true
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const rawText = await response.text();
      addDebugMessage('Raw response text:', rawText);
      const responseData = JSON.parse(rawText);
      addDebugMessage('Response Payload:', responseData);

      // Start polling if we have a ServiceNow request ID
      if (responseData.servicenow_response?.requestId) {
        const requestId = responseData.servicenow_response.requestId;
        addDebugMessage('Starting polling for request:', requestId);

        const origin = window.location.origin;
        const pollUrl = `${origin}/servicenow/responses/${requestId}`;
        addDebugMessage('Polling URL:', pollUrl);

        setIsPolling(true);
        let attempts = 0;
        const maxAttempts = 60;

        const pollInterval = setInterval(async () => {
          if (!isPolling) {
            addDebugMessage('Polling stopped: isPolling is false');
            clearInterval(pollInterval);
            return;
          }

          if (attempts >= maxAttempts) {
            addDebugMessage('Polling stopped: max attempts reached');
            clearInterval(pollInterval);
            setIsPolling(false);
            addMessage('No more responses from ServiceNow', 'bot-message system-message');
            return;
          }

          attempts++;
          addDebugMessage(`Polling attempt ${attempts}/${maxAttempts} for request ${requestId}`);

          try {
            addDebugMessage('Sending poll request to:', pollUrl);
            const pollResponse = await fetch(pollUrl, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include'
            });

            if (!pollResponse.ok) {
              addDebugMessage('Poll request failed:', pollResponse.status);
              if (pollResponse.status === 401) {
                // Handle authentication error
                addDebugMessage('Authentication failed, redirecting to login');
                window.location.href = '/login';
                return;
              }
              throw new Error(`Poll failed: ${pollResponse.status}`);
            }

            const pollText = await pollResponse.text();
            addDebugMessage('Poll Response Text:', pollText);

            const pollData = JSON.parse(pollText);
            addDebugMessage('Poll Response Data:', pollData);

            if (pollData.servicenow_response && pollData.servicenow_response.body) {
              const snMessages = pollData.servicenow_response.body;
              let hasContent = false;
              let hasSpinner = false;

              addDebugMessage(`Processing ${snMessages.length} messages`);
              for (const msg of snMessages) {
                addDebugMessage('Processing message:', msg);
                switch (msg.uiType) {
                  case 'ActionMsg':
                    switch (msg.actionType) {
                      case 'StartSpinner':
                        hasSpinner = true;
                        setIsLoading(true);
                        break;
                      case 'EndSpinner':
                        hasSpinner = true;
                        setIsLoading(false);
                        break;
                      case 'System':
                        hasContent = true;
                        addMessage(msg.message, 'bot-message system-message');
                        break;
                      case 'StartConversation':
                        // Optional: handle as needed
                        break;
                      default:
                        if (msg.message) {
                          hasContent = true;
                          addMessage(msg.message, 'bot-message');
                        }
                        break;
                    }
                    break;
                  case 'OutputCard':
                    hasContent = true;
                    try {
                      const cardData = JSON.parse(msg.data);
                      for (const field of (cardData.fields || [])) {
                        if (field.fieldLabel === 'Top Result:') {
                          addMessage(field.fieldValue, 'bot-message');
                        } else if (field.fieldLabel.includes('KB')) {
                          const linkMessage = `Learn more: ${field.fieldValue}`;
                          addMessage(linkMessage, 'bot-message link-message');
                        }
                      }
                    } catch (e) {
                      console.error('Failed to parse card data:', e);
                      addDebugMessage('Error parsing card:', e.message);
                    }
                    break;
                  case 'Picker':
                    hasContent = true;
                    const pickerMessage = `${msg.label}\n${msg.options
                      .map((opt, i) => `${i + 1}. ${opt.label}`)
                      .join('\n')}`;
                    addMessage(pickerMessage, 'bot-message picker-message');
                    break;
                  default:
                    // If unknown, just display something
                    addMessage(JSON.stringify(msg), 'bot-message');
                    break;
                }
              }

              // Acknowledge messages if we got anything
              if (hasContent || hasSpinner) {
                try {
                  addDebugMessage('Acknowledging messages');
                  const ackResponse = await fetch(`${pollUrl}?acknowledge=true`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include'
                  });
                  if (!ackResponse.ok) {
                    addDebugMessage('Failed to acknowledge messages:', ackResponse.status);
                  }
                } catch (e) {
                  addDebugMessage('Error acknowledging messages:', e.message);
                }
              }

              // Stop polling if real content arrived
              if (hasContent) {
                addDebugMessage('Stopping poll: content received');
                clearInterval(pollInterval);
                setIsPolling(false);
                return;
              }
            } else {
              addDebugMessage('No messages in response');
            }
          } catch (error) {
            console.error('Error during polling:', error);
            addDebugMessage('Polling error:', error.message);
          }
        }, 1000);
      } else if (responseData.response) {
        // Handle GPT-only response
        addMessage(responseData.response, 'bot-message');
      }
    } catch (error) {
      console.error('Error:', error);
      addDebugMessage('Error:', error);
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
      setMessages(prev => [...prev, { text: 'Logout failed', type: 'error-message' }]);
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
      {/*
        Pass messages to ChatMessages and bind the ref so we can scroll to bottom
      */}
      <ChatMessages ref={chatMessagesRef} messages={messages} isLoading={isLoading} />
      <ConversationStarters onSelect={handleSendMessage} />
      <ChatInput onSendMessage={handleSendMessage} />
    </div>
  );
};

export default ChatContainer;
