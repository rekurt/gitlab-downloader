import React, { useState, useEffect, useRef } from 'react';
import {
  Progress,
  Typography,
  List,
  Button,
  Tag,
  Alert,
} from 'antd';
import { StopOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const STATUS_CONFIG = {
  pending: { color: 'orange', label: 'PENDING' },
  running: { color: 'blue', label: 'RUNNING' },
  completed: { color: 'green', label: 'COMPLETED' },
  failed: { color: 'red', label: 'FAILED' },
};

function ProgressIndicator({
  migrationId,
  onComplete,
  onError,
  onCancel,
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
      <div className="p-6 text-center">
        <Text type="secondary">Waiting for progress...</Text>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[progress.status] || { color: 'default', label: 'UNKNOWN' };
  const isIndeterminate = progress.progress < 0;
  const percent = isIndeterminate ? 0 : progress.progress;
  const progressStatus =
    progress.status === 'failed' ? 'exception' :
      progress.status === 'completed' ? 'success' :
        'active';

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <Title level={4} className="mb-0">Migration Progress</Title>
        <Tag color={statusConfig.color}>{statusConfig.label}</Tag>
      </div>

      {error && (
        <Alert
          type="error"
          title={error}
          showIcon
          className="mb-4"
        />
      )}

      <div className="mb-4">
        <Progress
          percent={percent}
          status={progressStatus}
          format={() => (isIndeterminate ? '...' : `${progress.progress}%`)}
        />
      </div>

      {progress.current_task && (
        <div className="mb-4">
          <Text type="secondary">Current Task: </Text>
          <Text>{progress.current_task}</Text>
        </div>
      )}

      {progress.messages && progress.messages.length > 0 && (
        <div className="mb-4">
          <Text strong className="block mb-2">Messages:</Text>
          <div
            className="max-h-48 overflow-y-auto border border-gray-200 rounded p-2 bg-gray-50"
          >
            <List
              size="small"
              dataSource={progress.messages}
              renderItem={(msg) => <List.Item className="py-1">{msg}</List.Item>}
            />
          </div>
        </div>
      )}

      {!isFinished && (
        <Button
          danger
          icon={<StopOutlined />}
          onClick={async () => {
            if (window.electronAPI) {
              await window.electronAPI.cancelMigration(migrationId);
              if (onCancel) onCancel();
            }
          }}
        >
          Cancel Migration
        </Button>
      )}

      {isFinished && (
        <Alert
          type={progress.status === 'completed' ? 'success' : 'error'}
          title={
            progress.status === 'completed'
              ? 'Migration completed successfully'
              : 'Migration failed'
          }
          showIcon
          className="mt-4"
        />
      )}
    </div>
  );
}

export default ProgressIndicator;
