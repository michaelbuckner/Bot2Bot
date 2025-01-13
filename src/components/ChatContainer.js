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

    addMessage(message, 'user-message');

    try {
      const requestPayload = {
        message,
        session_id: sessionId.current,
        use_servicenow: isServiceNow
      };

      const origin = window.location.origin;
      const chatUrl = `${origin}/chat`;

      if (isDebug) {
        addDebugMessage('Request Payload:', requestPayload);
        addDebugMessage('Chat URL:', chatUrl);
      }

      const response = await fetch(chatUrl, {
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
        if (data.servicenow_response?.requestId) {
          const requestId = data.servicenow_response.requestId;
          let attempts = 0;
          const maxAttempts = 30;

          const pollInterval = setInterval(async () => {
            if (!isPolling) {
              clearInterval(pollInterval);
              return;
            }

            try {
              if (attempts >= maxAttempts) {
                setIsPolling(false);
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

              const pollUrl = `${origin}/servicenow/responses/${requestId}`;
              const pollResponse = await fetch(pollUrl, {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include'
              });

              if (!pollResponse.ok) {
                throw new Error(`Poll failed: ${pollResponse.status} ${pollResponse.statusText}`);
              }

              const pollData = await pollResponse.json();
              
              if (pollData.messages && pollData.messages.length > 0) {
                pollData.messages.forEach(msg => {
                  if (msg.uiType === 'OutputCard' || msg.uiType === 'OutputText') {
                    addMessage(msg.value || msg.text || JSON.stringify(msg), 'bot-message');
                  }
                });
              }

              if (pollData.done) {
                setIsPolling(false);
                clearInterval(pollInterval);
                if (isDebug) {
                  addDebugMessage('Polling complete');
                }
              }
            } catch (error) {
              console.error('Polling error:', error);
              if (isDebug) {
                addDebugMessage('Polling error:', error.message);
              }
              setIsPolling(false);
              clearInterval(pollInterval);
            }
          }, 1000);
          pollIntervalRef.current = pollInterval;
          setIsPolling(true);
        }
      } else {
        if (data.response) {
          addMessage(data.response, 'bot-message');
        }
      }
    } catch (error) {
      console.error('Error:', error);
      addMessage(`Error: ${error.message}`, 'error-message');
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
      <ChatMessages messages={messages} />
      <ConversationStarters onSelect={handleSendMessage} />
      <ChatInput onSendMessage={handleSendMessage} />
    </div>
  );
};

export default ChatContainer;
