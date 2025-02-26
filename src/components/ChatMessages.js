import React, { useRef, useEffect } from 'react';
import servicenowIcon from '../assets/servicenow-icon.png';
import openaiIcon from '../assets/openai.png';

const ChatMessages = React.forwardRef(({ messages, isLoading, isPolling }, ref) => {
  // Smooth scroll to bottom when messages change
  useEffect(() => {
    if (ref?.current) {
      const scrollOptions = {
        top: ref.current.scrollHeight,
        behavior: 'smooth'
      };
      ref.current.scrollTo(scrollOptions);
    }
  }, [messages, ref]);

  // Group messages by type (user/bot) to create message groups
  const groupedMessages = messages.reduce((groups, message, index) => {
    const isUserMessage = message.type === 'user-message';
    const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
    
    // If this is the first message or the message type is different from the last group
    if (!lastGroup || (isUserMessage && lastGroup.type !== 'user') || (!isUserMessage && lastGroup.type !== 'bot')) {
      groups.push({
        type: isUserMessage ? 'user' : 'bot',
        messages: [{ ...message, index }]
      });
    } else {
      // Add to the last group
      lastGroup.messages.push({ ...message, index });
    }
    
    return groups;
  }, []);

  const renderMessageContent = (message) => {
    // Handle link messages
    if (message.type === 'bot-message link-message') {
      const url = message.text.replace('Learn more: ', '');
      return (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {message.text}
        </a>
      );
    }
    
    // Handle picker messages with line breaks
    if (message.type === 'bot-message picker-message') {
      return <pre className="picker-options">{message.text}</pre>;
    }
    
    // Regular messages
    return <div className="message-content">{message.text}</div>;
  };

  const renderMessageGroup = (group, groupIndex) => {
    const isUserGroup = group.type === 'user';
    const iconSrc = isUserGroup ? null : (group.messages[0].source === 'servicenow' ? servicenowIcon : openaiIcon);
    const iconAlt = isUserGroup ? null : (group.messages[0].source === 'servicenow' ? 'ServiceNow' : 'OpenAI');
    
    return (
      <div key={groupIndex} className={`message-group ${group.type}`}>
        <div className="message-container">
          {group.messages.map((message, i) => (
            <div 
              key={`${groupIndex}-${i}`} 
              className={`message ${message.type}`}
            >
              {!isUserGroup && i === 0 && (
                <div className="message-icon">
                  <img 
                    src={iconSrc}
                    alt={iconAlt}
                    className="source-icon"
                  />
                </div>
              )}
              {renderMessageContent(message)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="chat-messages" ref={ref}>
      {groupedMessages.map(renderMessageGroup)}
      
      {(isLoading || isPolling) && (
        <div className="message-group bot">
          <div className="message-container">
            <div className="message bot-message loading">
              <div className="message-icon">
                <img 
                  src={openaiIcon}
                  alt="AI"
                  className="source-icon"
                />
              </div>
              <div className="typing-indicator">
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatMessages;
