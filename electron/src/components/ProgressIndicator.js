import React, { useState, useEffect, useRef } from 'react';
import '../styles/ProgressIndicator.css';

function ProgressIndicator({
  migrationId,
  onComplete,
  onError,
}) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [isFinished, setIsFinished] = useState(false);

  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!migrationId || !window.electronAPI) {
      return;
    }

    const cleanup = window.electronAPI.onMigrationProgress((data) => {
      if (data.migrationId !== migrationId) return;

      setProgress(data);

      if (data.status === 'completed') {
        setIsFinished(true);
        if (onCompleteRef.current) {
          onCompleteRef.current(data);
        }
      } else if (data.status === 'failed') {
        setIsFinished(true);
        setError(data.error || 'Migration failed');
        if (onErrorRef.current) {
          onErrorRef.current(data.error || 'Migration failed');
        }
      }
    });

    return cleanup;
  }, [migrationId]);

  if (!progress) {
    return (
      <div className="progress-container">
        <div className="progress-loading">Waiting for progress...</div>
      </div>
    );
  }

  const statusColor = {
    pending: '#ff9800',
    running: '#2196f3',
    completed: '#4caf50',
    failed: '#f44336',
  }[progress.status] || '#666';

  return (
    <div className="progress-container">
      <div className="progress-header">
        <h3>Migration Progress</h3>
        <span className="progress-status" style={{ color: statusColor }}>
          {progress.status.toUpperCase()}
        </span>
      </div>

      {error && <div className="progress-error">{error}</div>}

      <div className="progress-bar-container">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width: `${progress.progress}%`,
              backgroundColor: statusColor,
            }}
          />
        </div>
        <span className="progress-percentage">{progress.progress}%</span>
      </div>

      {progress.current_task && (
        <div className="progress-task">
          <span className="task-label">Current Task:</span>
          <span className="task-name">{progress.current_task}</span>
        </div>
      )}

      {progress.messages && progress.messages.length > 0 && (
        <div className="progress-messages">
          <div className="messages-label">Messages:</div>
          <ul className="messages-list">
            {progress.messages.map((msg, idx) => (
              <li key={idx}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {isFinished && (
        <div className={`progress-finish ${progress.status}`}>
          {progress.status === 'completed'
            ? '✓ Migration completed successfully'
            : '✗ Migration failed'}
        </div>
      )}
    </div>
  );
}

export default ProgressIndicator;
