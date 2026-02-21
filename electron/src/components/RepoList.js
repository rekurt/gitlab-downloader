import React, { useState, useEffect } from 'react';
import '../styles/RepoList.css';

function RepoList({ apiEndpoint, onSelectRepo, onMigrationStart }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);

  useEffect(() => {
    const fetchRepos = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`${apiEndpoint}/api/repos`);
        if (!response.ok) {
          throw new Error(`Failed to fetch repositories: ${response.statusText}`);
        }

        const data = await response.json();
        setRepos(data.repositories || []);
      } catch (err) {
        setError(err.message);
        setRepos([]);
      } finally {
        setLoading(false);
      }
    };

    if (apiEndpoint) {
      fetchRepos();
      const interval = setInterval(fetchRepos, 10000);
      return () => clearInterval(interval);
    }
  }, [apiEndpoint]);

  const handleSelectRepo = (repo) => {
    setSelectedRepo(repo);
    if (onSelectRepo) {
      onSelectRepo(repo);
    }
  };

  const handleMigrate = () => {
    if (selectedRepo && onMigrationStart) {
      onMigrationStart(selectedRepo);
    }
  };

  if (loading) {
    return (
      <div className="repo-list-container">
        <div className="repo-list-loading">Loading repositories...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="repo-list-container">
        <div className="repo-list-error">
          <p>Error loading repositories: {error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="repo-list-container">
      <div className="repo-list-header">
        <h2>Cloned Repositories</h2>
        <span className="repo-count">{repos.length} repositories</span>
      </div>

      {repos.length === 0 ? (
        <div className="repo-list-empty">
          <p>No repositories cloned yet.</p>
          <p>Use the CLI to clone repositories first.</p>
        </div>
      ) : (
        <>
          <div className="repo-list">
            {repos.map((repo, index) => (
              <div
                key={index}
                className={`repo-item ${selectedRepo?.path === repo.path ? 'selected' : ''}`}
                onClick={() => handleSelectRepo(repo)}
              >
                <div className="repo-name">{repo.name}</div>
                <div className="repo-url">{repo.url}</div>
                <div className="repo-path">{repo.path}</div>
                {repo.last_updated && (
                  <div className="repo-updated">
                    Updated: {new Date(repo.last_updated).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>

          {selectedRepo && (
            <div className="repo-actions">
              <button
                className="btn-migrate"
                onClick={handleMigrate}
              >
                Start Migration
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default RepoList;
