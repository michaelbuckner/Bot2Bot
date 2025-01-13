import React, { useState, useRef, useEffect, useCallback } from 'react';
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

  const addMessage = useCallback((text, type, source = 'openai') => {
    if (!text) {
      console.error('Empty message content');
      return;
    }
    setMessages(prev => [...prev, { text, type, source }]);
  }, []);

  const addDebugMessage = (label, data = '') => {
    if (!isDebug) return;
    const debugContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    addMessage(`${label} ${debugContent}`, 'debug-message');
  };

  const processMessages = useCallback((messages) => {
    console.log('Processing messages:', messages);
    let hasContent = false;
    messages.forEach((msg) => {
      console.log('Processing message:', msg);
      switch (msg.uiType) {
        case 'OutputCard':
          console.log('Processing OutputCard:', msg);
          hasContent = true;
          try {
            const cardData = JSON.parse(msg.data);
            console.log('Parsed card data:', cardData);
            for (const field of (cardData.fields || [])) {
              console.log('Processing field:', field);
              if (field.fieldLabel === 'Top Result:') {
                console.log('Adding top result message:', field.fieldValue);
                addMessage(field.fieldValue, 'bot-message', 'servicenow');
              } else if (field.fieldLabel.includes('KB')) {
                console.log('Adding KB link message:', field.fieldValue);
                addMessage(`Learn more: ${field.fieldValue}`, 'bot-message link-message', 'servicenow');
              }
            }
          } catch (e) {
            console.error('Failed to parse card data:', e);
            addDebugMessage('Error parsing card:', e.message);
          }
          break;
        case 'Picker':
          console.log('Processing Picker:', msg);
          hasContent = true;
          const pickerMessage = `${msg.label}\n${msg.options
            .map((opt, i) => `${i + 1}. ${opt.label}`)
            .join('\n')}`;
          console.log('Adding picker message:', pickerMessage);
          addMessage(pickerMessage, 'bot-message picker-message', 'servicenow');
          break;
        case 'ActionMsg':
          console.log('Processing ActionMsg:', msg);
          if (msg.message && !msg.message.includes('Please wait')) {
            console.log('Adding action message:', msg.message);
            hasContent = true;
            addMessage(msg.message, 'bot-message', 'servicenow');
          }
          break;
        default:
          console.log('Unknown message type:', msg.uiType);
          break;
      }
    });
    console.log('Message processing complete. Has content:', hasContent);
    return hasContent;
  }, [addMessage, addDebugMessage]);

  const handlePollResponse = useCallback(async (response) => {
    console.log('Handling poll response:', response);
    if (response.ok) {
      const data = await response.json();
      console.log('Poll response data:', data);

      // Extract messages from the servicenow_response
      const messages = data?.servicenow_response?.body || [];
      console.log('ServiceNow messages:', messages);

      if (messages.length > 0) {
        console.log('Processing messages from poll:', messages);
        const hasContent = processMessages(messages);
        console.log('Poll processing complete. Has content:', hasContent);
        if (hasContent) {
          setIsLoading(false);
        }
      } else {
        console.log('No messages in poll response');
      }
    } else {
      console.error('Poll response not ok:', response.status);
    }
  }, [processMessages]);

  const handleSendMessage = async (message) => {
    if (!message.trim()) return;

    try {
      console.log('Sending message:', message);
      addMessage(message, 'user-message');
      setIsLoading(true);

      const response = await fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          session_id: sessionId.current,
          use_servicenow: true
        }),
        credentials: 'include'
      });

      console.log('Chat response:', response);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Chat response data:', data);

      // Check for request_id in the correct location
      const requestId = data?.servicenow_response?.requestId;
      console.log('ServiceNow request ID:', requestId);

      if (requestId) {
        console.log('Starting polling for request:', requestId);
        let pollCount = 0;
        const maxPolls = 30; // Maximum number of polling attempts
        
        const pollInterval = setInterval(async () => {
          try {
            console.log(`Polling attempt ${pollCount + 1} for request ${requestId}`);
            const pollResponse = await fetch(`/servicenow/responses/${requestId}`, {
              method: 'GET',
              credentials: 'include'
            });

            console.log('Poll response:', pollResponse);
            if (!pollResponse.ok) {
              console.error('Poll request failed:', pollResponse.status);
              throw new Error(`Poll failed: ${pollResponse.status}`);
            }

            const pollData = await pollResponse.json();
            console.log('Poll response data:', pollData);

            // Extract messages from the servicenow_response
            const messages = pollData?.servicenow_response?.body || [];
            console.log('ServiceNow messages:', messages);

            if (messages.length > 0) {
              console.log('Processing messages from poll:', messages);
              const hasContent = processMessages(messages);
              if (hasContent) {
                console.log('Content received, stopping polling');
                clearInterval(pollInterval);
                setIsLoading(false);
              }
            }

            pollCount++;
            if (pollCount >= maxPolls) {
              console.log(`Reached maximum poll attempts (${maxPolls})`);
              clearInterval(pollInterval);
              setIsLoading(false);
              addMessage("I'm sorry, but I didn't receive a response in time. Please try again.", 'bot-message system-message');
            }
          } catch (error) {
            console.error('Error during polling:', error);
            clearInterval(pollInterval);
            setIsLoading(false);
            addMessage('An error occurred while getting the response. Please try again.', 'bot-message system-message');
          }
        }, 1000);
      } else {
        console.log('No ServiceNow request ID found in response');
        if (data.response) {
          console.log('Adding direct response:', data.response);
          addMessage(data.response, 'bot-message');
        }
        setIsLoading(false);
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
