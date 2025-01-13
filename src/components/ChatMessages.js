import React, { useEffect, useRef } from 'react';

const ChatMessages = ({ messages }) => {
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="chat-messages" id="chatMessages">
      {messages.length === 0 && (
        <div className="welcome-message">
          <h2>Welcome to AI Assistant</h2>
          <p>How can I help you today?</p>
        </div>
      )}
      {messages.map((message) => (
        <div key={message.id} className={message.className}>
          {message.content}
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatMessages;
