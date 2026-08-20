import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Radio, Typography } from 'antd';

export default function TransferPage() {
  const [plan, setPlan] = useState(null);
  const [planId, setPlanId] = useState(null);
  const operationIdRef = useRef(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const cleanup = window.electronAPI?.onOperationEvent?.((event) => {
      if (event.operationId !== operationIdRef.current) return;
      if (['finished', 'partial', 'failed', 'canceled'].includes(event.status)) {
        setResult(event.result || event);
      }
    });
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, []);

  const createPlan = async (values) => {
    setResult(null);
    try {
      const response = await window.electronAPI.planTransfer({
        source: { url: values.sourceUrl, fullPath: values.sourcePath, type: values.sourceType },
        destination: { url: values.destinationUrl, namespace: values.destinationNamespace },
      });
      if (!response.success) throw new Error(response.error || 'Unable to create transfer plan');
      setPlan(response.plan);
      setPlanId(response.planId);
    } catch (error) {
      setResult({ status: 'failed', failures: [{ message: error.message }] });
    }
  };
  const start = async () => {
    try {
      const response = await window.electronAPI.startTransfer({ planId });
      if (!response.success) throw new Error(response.error || 'Unable to start transfer');
      operationIdRef.current = response.operationId;
      setResult({ status: 'running' });
    } catch (error) {
      setResult({ status: 'failed', failures: [{ message: error.message }] });
    }
  };
  const status = result?.status;
  return (
    <div className="max-w-5xl mx-auto">
      <Typography.Title level={3}>GitLab transfer</Typography.Title>
      <Card>
        <Form layout="vertical" onFinish={createPlan} initialValues={{ sourceType: 'group' }}>
          <Form.Item name="sourceUrl" label="Source URL" rules={[{ required: true }, { type: 'url' }]}><Input /></Form.Item>
          <Form.Item name="destinationUrl" label="Destination URL" rules={[{ required: true }, { type: 'url' }]}><Input /></Form.Item>
          <Form.Item name="sourcePath" label="Source full path" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="destinationNamespace" label="Destination namespace" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="sourceType" label="Source type"><Radio.Group options={['group', 'project']} /></Form.Item>
          <Button htmlType="submit">Create safe plan</Button>
        </Form>
        {plan && (
          <>
            {plan.warnings.map((warning) => <Alert key={warning} className="mt-3" type="warning" title={warning} />)}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left">
                <thead><tr><th>Entity</th><th>Destination</th><th>Mode</th><th>Reason</th></tr></thead>
                <tbody>{plan.entities.map((entity) => (
                  <tr key={entity.id}>
                    <td>{entity.sourceFullPath}</td>
                    <td>{entity.destinationFullPath}</td>
                    <td>{entity.mode}</td>
                    <td>{entity.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Button className="mt-4" type="primary" onClick={start}>Run transfer</Button>
          </>
        )}
        {status && (
          <Alert
            className="mt-4"
            data-testid="transfer-result"
            type={status === 'finished' ? 'success' : status === 'partial' ? 'warning' : status === 'running' ? 'info' : 'error'}
            title={`Transfer: ${status}`}
            description={result.failures?.map((failure) => failure.message).join('; ')}
          />
        )}
      </Card>
    </div>
  );
}
