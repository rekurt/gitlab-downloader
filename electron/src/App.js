import React, { useEffect, useState } from 'react';
import './App.css';

function App() {
  const [apiStatus, setApiStatus] = useState('checking');
  const [apiEndpoint, setApiEndpoint] = useState('');

  useEffect(() => {
    async function checkApi() {
      try {
        const endpoint = await window.electronAPI.getApiEndpoint();
        setApiEndpoint(endpoint);

        const status = await window.electronAPI.checkApiStatus();
        setApiStatus(status ? 'connected' : 'disconnected');
      } catch (error) {
        console.error('Failed to check API status:', error);
        setApiStatus('error');
      }
    }

    checkApi();
    const interval = setInterval(checkApi, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>GitLab Dump Desktop</h1>
      </header>
      <main className="app-main">
        <div className="status-card">
          <h2>API Status</h2>
          <p>Endpoint: {apiEndpoint || 'Loading...'}</p>
          <p>
            Status:
            {apiStatus === 'checking' && ' Checking...'}
            {apiStatus === 'connected' && ' ✓ Connected'}
            {apiStatus === 'disconnected' && ' ✗ Disconnected'}
            {apiStatus === 'error' && ' ✗ Error'}
          </p>
        </div>
        <div className="welcome-card">
          <h2>Welcome to GitLab Dump</h2>
          <p>Manage your GitLab repositories and migrations from here.</p>
          <p>More features coming soon...</p>
        </div>
      </main>
    </div>
  );
}

export default App;
