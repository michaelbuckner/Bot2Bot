import React, { useRef, useEffect } from 'react';

const ChatMessages = React.forwardRef(({ messages, isLoading }, ref) => {
  useEffect(() => {
    if (ref?.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages, ref]);

  const renderMessage = (message, index) => {
    // Handle link messages
    if (message.type === 'bot-message link-message') {
      const url = message.text.replace('Learn more: ', '');
      return (
        <div key={index} className={`message ${message.type}`}>
          <div className="message-icon">
            <img 
              src={message.source === 'servicenow' ? '/images/servicenow-icon.png' : '/images/openai.png'} 
              alt={message.source === 'servicenow' ? 'ServiceNow' : 'OpenAI'} 
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
              src={message.source === 'servicenow' ? '/images/servicenow-icon.png' : '/images/openai.png'} 
              alt={message.source === 'servicenow' ? 'ServiceNow' : 'OpenAI'} 
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
              src={message.source === 'servicenow' ? '/images/servicenow-icon.png' : '/images/openai.png'} 
              alt={message.source === 'servicenow' ? 'ServiceNow' : 'OpenAI'} 
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
          <div className="loading-spinner">
            <div className="spinner-dots">
              <div></div>
              <div></div>
              <div></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatMessages;
