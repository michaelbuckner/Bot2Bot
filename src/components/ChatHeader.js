import React from 'react';
import servicenowIcon from '/images/servicenow-icon.png';
import openaiIcon from '/images/openai.png';

const ChatHeader = ({ 
  isServiceNow, 
  setIsServiceNow, 
  isDarkMode, 
  setIsDarkMode, 
  isDebug, 
  setIsDebug, 
  onLogout 
}) => {
  return (
    <div className="chat-header">
      <div className="mode-toggles">
        <div className="toggle-container">
          <img 
            src={openaiIcon}
            alt="GPT" 
            className="toggle-label"
            style={{ width: '24px', height: '24px' }}
          />
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isServiceNow}
              onChange={(e) => setIsServiceNow(e.target.checked)}
            />
            <span className="slider round"></span>
          </label>
          <img 
            src={servicenowIcon}
            alt="ServiceNow" 
            className="toggle-label"
            style={{ width: '24px', height: '24px' }}
          />
        </div>
        
        <div className="toggle-container">
          <span className="toggle-label">Light</span>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isDarkMode}
              onChange={(e) => setIsDarkMode(e.target.checked)}
            />
            <span className="slider round"></span>
          </label>
          <span className="toggle-label">Dark</span>
        </div>

        <div className="toggle-container">
          <span className="toggle-label">Debug</span>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isDebug}
              onChange={(e) => setIsDebug(e.target.checked)}
            />
            <span className="slider round"></span>
          </label>
        </div>
      </div>

      <button 
        onClick={onLogout}
        className="logout-button"
        style={{
          padding: '8px 16px',
          backgroundColor: '#dc3545',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        Logout
      </button>
    </div>
  );
};

export default ChatHeader;
