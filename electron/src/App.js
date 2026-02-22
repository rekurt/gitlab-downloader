import React, { useEffect, useState } from 'react';
import RepoList from './components/RepoList';
import MigrationWizard from './components/MigrationWizard';
import './App.css';

function App() {
  const [apiStatus, setApiStatus] = useState('checking');
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [clonePath, setClonePath] = useState('');
  const [currentView, setCurrentView] = useState('repos');
  const [selectedRepo, setSelectedRepo] = useState(null);

  useEffect(() => {
    async function checkApi() {
      try {
        const endpoint = await window.electronAPI.getApiEndpoint();
        setApiEndpoint(endpoint);

        const token = await window.electronAPI.getApiToken();
        setApiToken(token || '');

        const path = await window.electronAPI.getClonePath();
        setClonePath(path || '');

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

  const handleMigrationStart = (repo) => {
    setSelectedRepo(repo);
    setCurrentView('migration');
  };

  const handleMigrationComplete = () => {
    setCurrentView('repos');
    setSelectedRepo(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>GitLab Dump Desktop</h1>
        <div className="header-status">
          <span
            className={`status-indicator ${apiStatus}`}
            title={`API Status: ${apiStatus}`}
          />
          {apiStatus === 'connected' && (
            <span className="status-text">Connected</span>
          )}
          {apiStatus === 'disconnected' && (
            <span className="status-text">Disconnected</span>
          )}
          {apiStatus === 'checking' && (
            <span className="status-text">Checking...</span>
          )}
          {apiStatus === 'error' && (
            <span className="status-text">Error</span>
          )}
        </div>
      </header>

      <nav className="app-nav">
        <button
          className={`nav-button ${currentView === 'repos' ? 'active' : ''}`}
          onClick={() => {
            setCurrentView('repos');
            setSelectedRepo(null);
          }}
        >
          Repositories
        </button>
      </nav>

      <main className="app-main">
        {apiStatus !== 'connected' && (
          <div className="connection-notice">
            <p>
              ⚠️ API is not connected. Make sure the backend is running.
            </p>
          </div>
        )}

        {currentView === 'repos' && (
          <RepoList
            apiEndpoint={apiEndpoint}
            apiToken={apiToken}
            clonePath={clonePath}
            onSelectRepo={setSelectedRepo}
            onMigrationStart={handleMigrationStart}
          />
        )}

        {currentView === 'migration' && selectedRepo && (
          <MigrationWizard
            apiEndpoint={apiEndpoint}
            apiToken={apiToken}
            repo={selectedRepo}
            onComplete={handleMigrationComplete}
            onCancel={() => {
              setCurrentView('repos');
              setSelectedRepo(null);
            }}
          />
        )}
      </main>
    </div>
  );
}

export default App;
