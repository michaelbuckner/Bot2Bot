import React, { useRef, useEffect } from 'react';
import servicenowIcon from '../assets/servicenow-icon.png';
import openaiIcon from '../assets/openai.png';

const ChatMessages = React.forwardRef(({ messages, isLoading }, ref) => {
  useEffect(() => {
    if (ref?.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages, ref]);

  const renderMessage = (message, index) => {
    const iconSrc = message.source === 'servicenow' ? servicenowIcon : openaiIcon;
    const iconAlt = message.source === 'servicenow' ? 'ServiceNow' : 'OpenAI';

    // Handle link messages
    if (message.type === 'bot-message link-message') {
      const url = message.text.replace('Learn more: ', '');
      return (
        <div key={index} className={`message ${message.type}`}>
          <div className="message-icon">
            <img 
              src={iconSrc}
              alt={iconAlt}
              className="source-icon"
            />
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer">
            {message.text}
          </a>
        </div>
      );
    }
    
    // Handle picker messages with line breaks
    if (message.type === 'bot-message picker-message') {
      return (
        <div key={index} className={`message ${message.type}`}>
          <div className="message-icon">
            <img 
              src={iconSrc}
              alt={iconAlt}
              className="source-icon"
            />
          </div>
          <pre className="picker-options">{message.text}</pre>
        </div>
      );
    }

    // Regular messages
    if (message.type === 'bot-message') {
      return (
        <div key={index} className={`message ${message.type}`}>
          <div className="message-icon">
            <img 
              src={iconSrc}
              alt={iconAlt}
              className="source-icon"
            />
          </div>
          <div className="message-content">{message.text}</div>
        </div>
      );
    }

    return (
      <div key={index} className={`message ${message.type}`}>
        <div className="message-content">{message.text}</div>
      </div>
    );
  };

  return (
    <div className="chat-messages" ref={ref}>
      {messages.length === 0 && (
        <div className="welcome-message">
          <h2>Welcome to AI Assistant</h2>
          <p>How can I help you today?</p>
        </div>
      )}
      {messages.map(renderMessage)}
      {isLoading && (
        <div className="message bot-message">
          <div className="avatar servicenow-avatar"></div>
          <div className="typing-indicator">
            <div className="typing-dot"></div>
            <div className="typing-dot"></div>
            <div className="typing-dot"></div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatMessages;
