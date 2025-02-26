import React, { useState, useEffect } from 'react';
import ChatContainer from './components/ChatContainer';
import Sidebar from './components/Sidebar';
import './App.css';

function App() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showSidebar, setShowSidebar] = useState(!isMobile);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) {
        setShowSidebar(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  return (
    <div className="app-container">
      {showSidebar && <Sidebar />}
      <div className="main-content">
        <ChatContainer toggleSidebar={toggleSidebar} isMobile={isMobile} />
      </div>
    </div>
  );
}

export default App;
