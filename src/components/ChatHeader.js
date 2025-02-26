import React from 'react';
import servicenowIcon from '../assets/servicenow-icon.png';
import openaiIcon from '../assets/openai.png';

const ChatHeader = ({ 
  isServiceNow, 
  setIsServiceNow, 
  isDarkMode, 
  setIsDarkMode, 
  isDebug, 
  setIsDebug, 
  onLogout,
  toggleSidebar,
  isMobile
}) => {
  return (
    <div className="chat-header">
      {isMobile && (
        <button 
          onClick={toggleSidebar}
          className="sidebar-toggle"
          aria-label="Toggle sidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
      )}
      
      <div className="mode-toggles">
        <div className="toggle-container" title="Switch between OpenAI and ServiceNow">
          <img 
            src={openaiIcon}
            alt="GPT" 
            className="toggle-icon"
            style={{ width: '24px', height: '24px', opacity: isServiceNow ? 0.6 : 1 }}
          />
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isServiceNow}
              onChange={(e) => setIsServiceNow(e.target.checked)}
              aria-label="Toggle between OpenAI and ServiceNow"
            />
            <span className="slider round"></span>
          </label>
          <img 
            src={servicenowIcon}
            alt="ServiceNow" 
            className="toggle-icon"
            style={{ width: '24px', height: '24px', opacity: isServiceNow ? 1 : 0.6 }}
          />
        </div>
        
        <div className="toggle-container" title="Toggle dark mode">
          <span className="toggle-label">Light</span>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isDarkMode}
              onChange={(e) => setIsDarkMode(e.target.checked)}
              aria-label="Toggle dark mode"
            />
            <span className="slider round"></span>
          </label>
          <span className="toggle-label">Dark</span>
        </div>

        <div className="toggle-container" title="Toggle debug mode">
          <span className="toggle-label">Debug</span>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isDebug}
              onChange={(e) => setIsDebug(e.target.checked)}
              aria-label="Toggle debug mode"
            />
            <span className="slider round"></span>
          </label>
        </div>
      </div>

      <button 
        onClick={onLogout}
        className="logout-button"
        aria-label="Logout"
      >
        Logout
      </button>
    </div>
  );
};

export default ChatHeader;
