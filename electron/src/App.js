import React, { useEffect, useState } from "react";
import RepoList from "./components/RepoList";
import MigrationWizard from "./components/MigrationWizard";


function App() {
  const [clonePath, setClonePath] = useState("");
  const [currentView, setCurrentView] = useState("repos");
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        if (window.electronAPI) {
          const path = await window.electronAPI.getClonePath();
          setClonePath(path || "");
        }
      } catch (error) {
        console.error("Failed to initialize config:", error);
      } finally {
        setReady(true);
      }
    }
    init();
  }, []);

  const handleMigrationStart = (repo) => {
    setSelectedRepo(repo);
    setCurrentView("migration");
  };

  const handleMigrationComplete = () => {
    setCurrentView("repos");
    setSelectedRepo(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>GitLab Dump Desktop</h1>
      </header>

      <nav className="app-nav">
        <button
          className={`nav-button ${currentView === "repos" ? "active" : ""}`}
          onClick={() => {
            setCurrentView("repos");
            setSelectedRepo(null);
          }}
        >
          Repositories
        </button>
      </nav>

      <main className="app-main">
        {!ready && (
          <div className="connection-notice">
            <p>Loading...</p>
          </div>
        )}

        {ready && currentView === "repos" && (
          <RepoList
            clonePath={clonePath}
            onSelectRepo={setSelectedRepo}
            onMigrationStart={handleMigrationStart}
          />
        )}

        {ready && currentView === "migration" && selectedRepo && (
          <MigrationWizard
            repo={selectedRepo}
            onComplete={handleMigrationComplete}
            onCancel={() => {
              setCurrentView("repos");
              setSelectedRepo(null);
            }}
          />
        )}
      </main>
    </div>
  );
}

export default App;
