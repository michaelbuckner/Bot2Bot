import React, { useRef, useEffect } from 'react';

const ChatMessages = React.forwardRef(({ messages, isLoading }, ref) => {
  useEffect(() => {
    if (ref?.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages, ref]);

  return (
    <div className="chat-messages" ref={ref}>
      {messages.length === 0 && (
        <div className="welcome-message">
          <h2>Welcome to AI Assistant</h2>
          <p>How can I help you today?</p>
        </div>
      )}
      {messages.map((message, index) => {
        // Handle link messages
        if (message.type === 'bot-message link-message') {
          const url = message.text.replace('Learn more: ', '');
          return (
            <div key={index} className={`message ${message.type}`}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {message.text}
              </a>
            </div>
          );
        }
        
        // Handle picker messages with line breaks
        if (message.type === 'bot-message picker-message') {
          return (
            <div key={index} className={`message ${message.type}`} style={{ whiteSpace: 'pre-line' }}>
              {message.text}
            </div>
          );
        }

        // Regular messages
        return (
          <div key={index} className={`message ${message.type}`}>
            {message.text}
          </div>
        );
      })}
      {isLoading && (
        <div className="message bot-message">
          <div className="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatMessages;
