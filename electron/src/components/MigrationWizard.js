import React, { useState } from 'react';
import {
  Steps,
  Button,
  Typography,
  Descriptions,
  Alert,
  Result,
  Space,
  Tag,
} from 'antd';
import {
  UserOutlined,
  EyeOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import AuthorMapper from './AuthorMapper';
import ProgressIndicator from './ProgressIndicator';

const { Title, Text } = Typography;

const STEP_ITEMS = [
  { title: 'Author Mappings', icon: <UserOutlined /> },
  { title: 'Review & Confirm', icon: <EyeOutlined /> },
  { title: 'Progress', icon: <LoadingOutlined /> },
  { title: 'Complete', icon: <CheckCircleOutlined /> },
];

function MigrationWizard({ repo, onComplete, onCancel }) {
  const [step, setStep] = useState(0);
  const [mappings, setMappings] = useState(null);
  const [migrationId, setMigrationId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleMappingsSave = async (savedMappings) => {
    setMappings(savedMappings);
    setStep(1);
  };

  const handleStartMigration = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      const result = await window.electronAPI.startMigration({
        repoPath: repo.path,
        authorMappings: mappings?.authorMappings || {},
        committerMappings: mappings?.committerMappings || {},
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to start migration');
      }

      setMigrationId(result.migrationId);
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMigrationComplete = () => {
    setStep(3);
  };

  const handleMigrationError = (errMsg) => {
    setError(errMsg);
    setMigrationId(null);
    setStep(1);
  };

  const renderMappingsTable = (title, mappingsObj) => {
    const entries = Object.entries(mappingsObj);
    if (entries.length === 0) return null;

    return (
      <div className="mb-4">
        <Text strong className="block mb-2">{title}</Text>
        <Descriptions bordered size="small" column={1}>
          {entries.map(([key, mapping]) => (
            <Descriptions.Item
              key={key}
              label={
                <span>
                  {mapping.original_name} &lt;{mapping.original_email}&gt;
                </span>
              }
            >
              {mapping.new_name} &lt;{mapping.new_email}&gt;
            </Descriptions.Item>
          ))}
        </Descriptions>
      </div>
    );
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <Title level={3}>Migration Wizard</Title>
        <Text type="secondary">Repository: {repo?.name}</Text>
      </div>

      <Steps
        current={step}
        items={STEP_ITEMS}
        className="mb-8"
      />

      {error && (
        <Alert
          type="error"
          title={error}
          showIcon
          closable
          onClose={() => setError(null)}
          className="mb-4"
        />
      )}

      {/* Step 0: Author Mappings */}
      {step === 0 && (
        <AuthorMapper
          onSave={handleMappingsSave}
          onCancel={onCancel}
        />
      )}

      {/* Step 1: Review & Confirm */}
      {step === 1 && mappings && (
        <div className="p-4">
          <Title level={4}>Review Mappings</Title>
          <Text type="secondary" className="block mb-4">
            Please review the author and committer mappings before proceeding:
          </Text>

          {renderMappingsTable('Author Mappings', mappings.authorMappings)}
          {renderMappingsTable('Committer Mappings', mappings.committerMappings)}

          {Object.keys(mappings.authorMappings).length === 0 &&
            Object.keys(mappings.committerMappings).length === 0 && (
            <Tag color="orange" className="mb-4">No mappings configured</Tag>
          )}

          <Alert
            type="warning"
            title="This operation will modify git history. Make sure you have a backup!"
            showIcon
            className="mb-6"
          />

          <Space>
            <Button onClick={() => setStep(0)} disabled={loading}>
              Previous
            </Button>
            <Button
              type="primary"
              onClick={handleStartMigration}
              loading={loading}
            >
              Start Migration
            </Button>
          </Space>
        </div>
      )}

      {/* Step 2: Progress */}
      {step === 2 && (
        <ProgressIndicator
          migrationId={migrationId}
          onComplete={handleMigrationComplete}
          onError={handleMigrationError}
          onCancel={() => {
            setMigrationId(null);
            setStep(1);
          }}
        />
      )}

      {/* Step 3: Complete */}
      {step === 3 && (
        <Result
          status="success"
          title="Migration Complete"
          subTitle="The migration has been completed successfully!"
          extra={[
            <Button key="close" type="primary" onClick={onComplete}>
              Close
            </Button>,
          ]}
        />
      )}
    </div>
  );
}

export default MigrationWizard;
