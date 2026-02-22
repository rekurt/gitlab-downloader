import React, { useState } from 'react';
import AuthorMapper from './AuthorMapper';
import ProgressIndicator from './ProgressIndicator';
import '../styles/MigrationWizard.css';

function MigrationWizard({ apiEndpoint, apiToken, repo, onComplete, onCancel }) {
  const [step, setStep] = useState(1);
  const [mappings, setMappings] = useState(null);
  const [migrationId, setMigrationId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleMappingsSave = async (savedMappings) => {
    setMappings(savedMappings);
    setStep(2);
  };

  const handleStartMigration = async () => {
    try {
      setLoading(true);
      setError(null);

      const headers = { 'Content-Type': 'application/json' };
      if (apiToken) {
        headers['X-API-Token'] = apiToken;
      }

      const response = await fetch(`${apiEndpoint}/api/migrate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          repo_path: repo.path,
          author_mappings: mappings?.authorMappings || {},
          committer_mappings: mappings?.committerMappings || {},
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start migration: ${response.statusText}`);
      }

      const data = await response.json();
      setMigrationId(data.migration_id);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMigrationComplete = () => {
    setStep(4);
    // Don't call onComplete here - let user see the success screen first.
    // The "Close" button on step 4 calls onCancel which navigates back.
  };

  const handleMigrationError = (errMsg) => {
    setError(errMsg);
  };

  return (
    <div className="migration-wizard-container">
      <div className="wizard-header">
        <h2>Migration Wizard</h2>
        <p className="repo-name">Repository: {repo?.name}</p>
      </div>

      <div className="wizard-steps">
        <div className={`step-indicator ${step >= 1 ? 'active' : ''}`}>
          <span className="step-number">1</span>
          <span className="step-label">Configure Authors</span>
        </div>
        <div className="step-connector" />
        <div className={`step-indicator ${step >= 2 ? 'active' : ''}`}>
          <span className="step-number">2</span>
          <span className="step-label">Review & Confirm</span>
        </div>
        <div className="step-connector" />
        <div className={`step-indicator ${step >= 3 ? 'active' : ''}`}>
          <span className="step-number">3</span>
          <span className="step-label">Migration In Progress</span>
        </div>
        <div className="step-connector" />
        <div className={`step-indicator ${step >= 4 ? 'active' : ''}`}>
          <span className="step-number">4</span>
          <span className="step-label">Complete</span>
        </div>
      </div>

      {error && <div className="wizard-error">{error}</div>}

      <div className="wizard-content">
        {step === 1 && (
          <AuthorMapper
            apiEndpoint={apiEndpoint}
            apiToken={apiToken}
            onSave={handleMappingsSave}
            onCancel={onCancel}
          />
        )}

        {step === 2 && mappings && (
          <div className="step-review">
            <h3>Review Mappings</h3>
            <p>Please review the author and committer mappings before proceeding:</p>

            {Object.keys(mappings.authorMappings).length > 0 && (
              <div className="review-section">
                <h4>Author Mappings</h4>
                <div className="mappings-review">
                  {Object.entries(mappings.authorMappings).map(([key, mapping]) => (
                    <div key={key} className="mapping-review-item">
                      <div className="original">
                        <strong>{mapping.original_name}</strong>
                        <span>&lt;{mapping.original_email}&gt;</span>
                      </div>
                      <div className="arrow">→</div>
                      <div className="new">
                        <strong>{mapping.new_name}</strong>
                        <span>&lt;{mapping.new_email}&gt;</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Object.keys(mappings.committerMappings).length > 0 && (
              <div className="review-section">
                <h4>Committer Mappings</h4>
                <div className="mappings-review">
                  {Object.entries(mappings.committerMappings).map(([key, mapping]) => (
                    <div key={key} className="mapping-review-item">
                      <div className="original">
                        <strong>{mapping.original_name}</strong>
                        <span>&lt;{mapping.original_email}&gt;</span>
                      </div>
                      <div className="arrow">→</div>
                      <div className="new">
                        <strong>{mapping.new_name}</strong>
                        <span>&lt;{mapping.new_email}&gt;</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="review-warning">
              ⚠️ This operation will modify git history. Make sure you have a backup!
            </div>

            <div className="review-actions">
              <button
                className="btn-back"
                onClick={() => setStep(1)}
                disabled={loading}
              >
                Back
              </button>
              <button
                className="btn-confirm"
                onClick={handleStartMigration}
                disabled={loading}
              >
                {loading ? 'Starting...' : 'Start Migration'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <ProgressIndicator
            apiEndpoint={apiEndpoint}
            apiToken={apiToken}
            migrationId={migrationId}
            onComplete={handleMigrationComplete}
            onError={handleMigrationError}
          />
        )}

        {step === 4 && (
          <div className="step-complete">
            <div className="success-icon">✓</div>
            <h3>Migration Complete</h3>
            <p>The migration has been completed successfully!</p>
            <button
              className="btn-finish"
              onClick={onCancel}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default MigrationWizard;
