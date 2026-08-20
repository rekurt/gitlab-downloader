import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Spin, Typography } from 'antd';

export default function OAuthDeviceFlow({ getValues, onAuthorized }) {
  const [operationId, setOperationId] = useState(null);
  const operationIdRef = useRef(null);
  const authorizedRef = useRef(onAuthorized);
  authorizedRef.current = onAuthorized;
  const [status, setStatus] = useState('idle');
  const [device, setDevice] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cleanup = window.electronAPI?.onOperationEvent?.((event) => {
      if (!operationIdRef.current || event.operationId !== operationIdRef.current) return;
      if (event.status === 'finished') {
        setStatus('finished');
        authorizedRef.current?.(event.profile);
      } else if (event.status === 'failed' || event.status === 'canceled') {
        setStatus(event.status);
        setError(event.message || `OAuth ${event.status}`);
      }
    });
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, []);

  const start = useCallback(async () => {
    setStatus('running');
    setError(null);
    try {
      const result = await window.electronAPI.startOAuth(getValues());
      if (!result.success) throw new Error(result.error || 'Unable to start OAuth');
      operationIdRef.current = result.operationId;
      setOperationId(result.operationId);
      setDevice({ verificationUri: result.verificationUri, userCode: result.userCode });
    } catch (caught) {
      setStatus('failed');
      setError(caught.message);
    }
  }, [getValues]);

  const cancel = useCallback(async () => {
    if (!operationId) return;
    try {
      await window.electronAPI.cancelOperation({ operationId });
    } catch (caught) {
      setStatus('failed');
      setError(caught.message);
    }
  }, [operationId]);

  const open = useCallback(async () => {
    try {
      const result = await window.electronAPI.openOAuth({ operationId });
      if (!result.success) throw new Error(result.error || 'Unable to open OAuth page');
    } catch (caught) {
      setStatus('failed');
      setError(caught.message);
    }
  }, [operationId]);

  if (status === 'finished') return <Alert type="success" showIcon title="Authorized" data-testid="oauth-success" />;
  if (status === 'failed' || status === 'canceled') {
    return <Alert type="error" showIcon title={error} action={<Button onClick={start}>Retry</Button>} />;
  }
  if (status === 'running') {
    return (
      <Space orientation="vertical" data-testid="oauth-running">
        {device ? (
          <>
            <Typography.Text>Code: <strong>{device.userCode}</strong></Typography.Text>
            <Button onClick={open}>Open authorization page</Button>
          </>
        ) : <Spin />}
        <Button danger onClick={cancel}>Cancel</Button>
      </Space>
    );
  }
  return <Button onClick={start} data-testid="oauth-start">Authorize with OAuth</Button>;
}
