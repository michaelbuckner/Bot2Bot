import React from 'react';

const ConversationStarters = ({ onSelect }) => {
  const starters = [
    "Write a poem about Fred Luddy",
    "What is spear phishing?"
  ];

  return (
    <div className="conversation-starters">
      {starters.map((starter, index) => (
        <button
          key={index}
          className="starter-button"
          onClick={() => onSelect(starter)}
        >
          {starter}
        </button>
      ))}
    </div>
  );
};

export default ConversationStarters;
