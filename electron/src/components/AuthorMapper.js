import React, { useState } from 'react';
import '../styles/AuthorMapper.css';

function AuthorMapper({ onSave, onCancel }) {
  const [mappings, setMappings] = useState([
    {
      type: 'author',
      original_name: '',
      original_email: '',
      new_name: '',
      new_email: '',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAddMapping = () => {
    setMappings([
      ...mappings,
      {
        type: mappings[mappings.length - 1]?.type || 'author',
        original_name: '',
        original_email: '',
        new_name: '',
        new_email: '',
      },
    ]);
  };

  const handleRemoveMapping = (index) => {
    if (mappings.length > 1) {
      setMappings(mappings.filter((_, i) => i !== index));
    }
  };

  const handleMappingChange = (index, field, value) => {
    const newMappings = [...mappings];
    newMappings[index] = {
      ...newMappings[index],
      [field]: value,
    };
    setMappings(newMappings);
  };

  const handleTypeChange = (index, newType) => {
    const newMappings = [...mappings];
    newMappings[index] = {
      ...newMappings[index],
      type: newType,
    };
    setMappings(newMappings);
  };

  const validateMappings = () => {
    return mappings.every(
      (m) =>
        m.original_name.trim() &&
        m.original_email.trim() &&
        m.new_name.trim() &&
        m.new_email.trim()
    );
  };

  const handleSave = async () => {
    if (!validateMappings()) {
      setError('All fields are required for each mapping');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const authorMappings = mappings
        .filter((m) => m.type === 'author')
        .reduce((acc, m) => {
          acc[m.original_email] = {
            original_name: m.original_name,
            original_email: m.original_email,
            new_name: m.new_name,
            new_email: m.new_email,
          };
          return acc;
        }, {});

      const committerMappings = mappings
        .filter((m) => m.type === 'committer')
        .reduce((acc, m) => {
          acc[m.original_email] = {
            original_name: m.original_name,
            original_email: m.original_email,
            new_name: m.new_name,
            new_email: m.new_email,
          };
          return acc;
        }, {});

      // Try to persist mappings to disk via IPC (best-effort)
      if (window.electronAPI) {
        try {
          await window.electronAPI.saveAuthorMappings({
            authorMappings,
            committerMappings,
          });
        } catch {
          // Saving to disk is optional; mappings are passed in-memory to migration
        }
      }

      if (onSave) {
        onSave({ authorMappings, committerMappings });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="author-mapper-container">
      <div className="author-mapper-header">
        <h2>Author Mapping</h2>
        <p>Map original authors to new identities</p>
      </div>

      {error && <div className="author-mapper-error">{error}</div>}

      <div className="mappings-list">
        {mappings.map((mapping, index) => (
          <div key={index} className="mapping-entry">
            <div className="mapping-type">
              <label>Type:</label>
              <select
                value={mapping.type}
                onChange={(e) => handleTypeChange(index, e.target.value)}
              >
                <option value="author">Author</option>
                <option value="committer">Committer</option>
              </select>
            </div>

            <div className="mapping-original">
              <div className="mapping-field">
                <label>Original Name:</label>
                <input
                  type="text"
                  value={mapping.original_name}
                  onChange={(e) =>
                    handleMappingChange(index, 'original_name', e.target.value)
                  }
                  placeholder="John Doe"
                />
              </div>
              <div className="mapping-field">
                <label>Original Email:</label>
                <input
                  type="email"
                  value={mapping.original_email}
                  onChange={(e) =>
                    handleMappingChange(index, 'original_email', e.target.value)
                  }
                  placeholder="john@example.com"
                />
              </div>
            </div>

            <div className="mapping-arrow">→</div>

            <div className="mapping-new">
              <div className="mapping-field">
                <label>New Name:</label>
                <input
                  type="text"
                  value={mapping.new_name}
                  onChange={(e) =>
                    handleMappingChange(index, 'new_name', e.target.value)
                  }
                  placeholder="John Smith"
                />
              </div>
              <div className="mapping-field">
                <label>New Email:</label>
                <input
                  type="email"
                  value={mapping.new_email}
                  onChange={(e) =>
                    handleMappingChange(index, 'new_email', e.target.value)
                  }
                  placeholder="john@newhost.com"
                />
              </div>
            </div>

            {mappings.length > 1 && (
              <button
                className="btn-remove"
                onClick={() => handleRemoveMapping(index)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="author-mapper-actions">
        <button
          className="btn-add-mapping"
          onClick={handleAddMapping}
          disabled={loading}
        >
          + Add Mapping
        </button>
      </div>

      <div className="author-mapper-footer">
        <button
          className="btn-cancel"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          className="btn-save"
          onClick={handleSave}
          disabled={loading || !validateMappings()}
        >
          {loading ? 'Saving...' : 'Save Mappings'}
        </button>
      </div>
    </div>
  );
}

export default AuthorMapper;
