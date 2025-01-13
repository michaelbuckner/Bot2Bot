import React from 'react';

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
          <span className="toggle-label">GPT</span>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isServiceNow}
              onChange={(e) => setIsServiceNow(e.target.checked)}
            />
            <span className="slider round"></span>
          </label>
          <span className="toggle-label">ServiceNow</span>
        </div>
        
        <div className="toggle-container">
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isDarkMode}
              onChange={(e) => setIsDarkMode(e.target.checked)}
            />
            <span className="slider round"></span>
          </label>
          <span className="toggle-label">Dark Mode</span>
        </div>
        
        <div className="toggle-container">
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isDebug}
              onChange={(e) => setIsDebug(e.target.checked)}
            />
            <span className="slider round"></span>
          </label>
          <span className="toggle-label">Debug</span>
        </div>
        
        <button 
          onClick={onLogout}
          style={{
            marginLeft: '20px',
            padding: '5px 10px',
            borderRadius: '4px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
};

export default ChatHeader;
