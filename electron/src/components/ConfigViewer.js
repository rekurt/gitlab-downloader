import React, { useState, useEffect } from 'react';
import '../styles/ConfigViewer.css';

/**
 * ConfigViewer component for viewing and editing migration configuration
 */
const ConfigViewer = ({ repoPath, onClose }) => {
  const [config, setConfig] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    loadConfig();
  }, [repoPath]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`http://localhost:5000/api/config?repo_path=${encodeURIComponent(repoPath)}`);
      const data = await response.json();
      if (data.found) {
        setConfig(data.config);
        setEditData(JSON.parse(JSON.stringify(data.config)));
      } else {
        setConfig(null);
        setEditData(null);
      }
    } catch (err) {
      setError(`Failed to load config: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setError(null);
      setSuccess(null);

      const response = await fetch(
        `http://localhost:5000/api/config?repo_path=${encodeURIComponent(repoPath)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source_repos_path: editData.source_repos_path,
            target_hosting_url: editData.target_hosting_url,
            target_token: editData.target_token,
            author_mappings: editData.author_mappings,
            committer_mappings: editData.committer_mappings,
            format: 'json',
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setConfig(editData);
      setEditing(false);
      setSuccess('Configuration saved successfully');
    } catch (err) {
      setError(`Failed to save config: ${err.message}`);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setEditData(JSON.parse(JSON.stringify(config)));
  };

  const handleAddAuthorMapping = () => {
    if (!editData.author_mappings) {
      editData.author_mappings = {};
    }
    const newKey = `author_${Date.now()}`;
    editData.author_mappings[newKey] = {
      original_name: '',
      original_email: '',
      new_name: '',
      new_email: '',
    };
    setEditData({ ...editData });
  };

  const handleAddCommitterMapping = () => {
    if (!editData.committer_mappings) {
      editData.committer_mappings = {};
    }
    const newKey = `committer_${Date.now()}`;
    editData.committer_mappings[newKey] = {
      original_name: '',
      original_email: '',
      new_name: '',
      new_email: '',
    };
    setEditData({ ...editData });
  };

  const handleRemoveMapping = (type, key) => {
    if (type === 'author') {
      delete editData.author_mappings[key];
    } else {
      delete editData.committer_mappings[key];
    }
    setEditData({ ...editData });
  };

  const handleMappingChange = (type, key, field, value) => {
    if (type === 'author') {
      editData.author_mappings[key][field] = value;
    } else {
      editData.committer_mappings[key][field] = value;
    }
    setEditData({ ...editData });
  };

  if (loading) {
    return (
      <div className="config-viewer">
        <div className="config-header">
          <h2>Configuration</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="loading">Loading configuration...</div>
      </div>
    );
  }

  if (!config && !editing) {
    return (
      <div className="config-viewer">
        <div className="config-header">
          <h2>Configuration</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="no-config">
          <p>No configuration found</p>
          <button className="btn btn-primary" onClick={() => {
            setEditData({
              source_repos_path: repoPath,
              target_hosting_url: '',
              target_token: '',
              author_mappings: {},
              committer_mappings: {},
            });
            setEditing(true);
          }}>
            Create Configuration
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="config-viewer">
      <div className="config-header">
        <h2>Configuration</h2>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {!editing ? (
        <div className="config-view">
          <div className="config-section">
            <h3>Basic Settings</h3>
            <div className="config-item">
              <label>Source Repository Path:</label>
              <span>{config.source_repos_path}</span>
            </div>
            <div className="config-item">
              <label>Target Hosting URL:</label>
              <span>{config.target_hosting_url || 'Not set'}</span>
            </div>
          </div>

          <div className="config-section">
            <h3>Author Mappings ({Object.keys(config.author_mappings || {}).length})</h3>
            {Object.keys(config.author_mappings || {}).length === 0 ? (
              <p className="empty-text">No author mappings configured</p>
            ) : (
              <div className="mappings-list">
                {Object.entries(config.author_mappings || {}).map(([key, mapping]) => (
                  <div key={key} className="mapping-item">
                    <div className="mapping-pair">
                      <div>
                        <strong>{mapping.original_name}</strong><br />
                        <span className="email">{mapping.original_email}</span>
                      </div>
                      <div className="arrow">→</div>
                      <div>
                        <strong>{mapping.new_name}</strong><br />
                        <span className="email">{mapping.new_email}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="config-section">
            <h3>Committer Mappings ({Object.keys(config.committer_mappings || {}).length})</h3>
            {Object.keys(config.committer_mappings || {}).length === 0 ? (
              <p className="empty-text">No committer mappings configured</p>
            ) : (
              <div className="mappings-list">
                {Object.entries(config.committer_mappings || {}).map(([key, mapping]) => (
                  <div key={key} className="mapping-item">
                    <div className="mapping-pair">
                      <div>
                        <strong>{mapping.original_name}</strong><br />
                        <span className="email">{mapping.original_email}</span>
                      </div>
                      <div className="arrow">→</div>
                      <div>
                        <strong>{mapping.new_name}</strong><br />
                        <span className="email">{mapping.new_email}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="config-actions">
            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              Edit Configuration
            </button>
          </div>
        </div>
      ) : (
        <div className="config-edit">
          <div className="config-section">
            <h3>Basic Settings</h3>
            <div className="form-group">
              <label>Source Repository Path:</label>
              <input
                type="text"
                value={editData.source_repos_path}
                onChange={(e) => setEditData({ ...editData, source_repos_path: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Target Hosting URL:</label>
              <input
                type="text"
                value={editData.target_hosting_url}
                onChange={(e) => setEditData({ ...editData, target_hosting_url: e.target.value })}
                placeholder="https://github.com/org"
              />
            </div>
            <div className="form-group">
              <label>Target Token:</label>
              <input
                type="password"
                value={editData.target_token}
                onChange={(e) => setEditData({ ...editData, target_token: e.target.value })}
              />
            </div>
          </div>

          <div className="config-section">
            <div className="section-header">
              <h3>Author Mappings</h3>
              <button className="btn btn-small" onClick={handleAddAuthorMapping}>
                + Add Mapping
              </button>
            </div>
            {Object.keys(editData.author_mappings || {}).length === 0 ? (
              <p className="empty-text">No author mappings</p>
            ) : (
              <div className="mappings-edit">
                {Object.entries(editData.author_mappings || {}).map(([key, mapping]) => (
                  <div key={key} className="mapping-edit-item">
                    <div className="mapping-inputs">
                      <input
                        type="text"
                        placeholder="Original Name"
                        value={mapping.original_name}
                        onChange={(e) => handleMappingChange('author', key, 'original_name', e.target.value)}
                      />
                      <input
                        type="email"
                        placeholder="Original Email"
                        value={mapping.original_email}
                        onChange={(e) => handleMappingChange('author', key, 'original_email', e.target.value)}
                      />
                      <span className="arrow">→</span>
                      <input
                        type="text"
                        placeholder="New Name"
                        value={mapping.new_name}
                        onChange={(e) => handleMappingChange('author', key, 'new_name', e.target.value)}
                      />
                      <input
                        type="email"
                        placeholder="New Email"
                        value={mapping.new_email}
                        onChange={(e) => handleMappingChange('author', key, 'new_email', e.target.value)}
                      />
                      <button
                        className="btn btn-danger btn-small"
                        onClick={() => handleRemoveMapping('author', key)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="config-section">
            <div className="section-header">
              <h3>Committer Mappings</h3>
              <button className="btn btn-small" onClick={handleAddCommitterMapping}>
                + Add Mapping
              </button>
            </div>
            {Object.keys(editData.committer_mappings || {}).length === 0 ? (
              <p className="empty-text">No committer mappings</p>
            ) : (
              <div className="mappings-edit">
                {Object.entries(editData.committer_mappings || {}).map(([key, mapping]) => (
                  <div key={key} className="mapping-edit-item">
                    <div className="mapping-inputs">
                      <input
                        type="text"
                        placeholder="Original Name"
                        value={mapping.original_name}
                        onChange={(e) => handleMappingChange('committer', key, 'original_name', e.target.value)}
                      />
                      <input
                        type="email"
                        placeholder="Original Email"
                        value={mapping.original_email}
                        onChange={(e) => handleMappingChange('committer', key, 'original_email', e.target.value)}
                      />
                      <span className="arrow">→</span>
                      <input
                        type="text"
                        placeholder="New Name"
                        value={mapping.new_name}
                        onChange={(e) => handleMappingChange('committer', key, 'new_name', e.target.value)}
                      />
                      <input
                        type="email"
                        placeholder="New Email"
                        value={mapping.new_email}
                        onChange={(e) => handleMappingChange('committer', key, 'new_email', e.target.value)}
                      />
                      <button
                        className="btn btn-danger btn-small"
                        onClick={() => handleRemoveMapping('committer', key)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="config-actions">
            <button className="btn btn-primary" onClick={handleSave}>
              Save Configuration
            </button>
            <button className="btn btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConfigViewer;
