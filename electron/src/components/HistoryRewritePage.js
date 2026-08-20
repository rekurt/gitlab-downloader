import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Space, Switch, Typography } from 'antd';

const confirmationPhrase = 'I UNDERSTAND THAT COMMIT SHAS WILL CHANGE';

export default function HistoryRewritePage() {
  const [repository, setRepository] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [outputDirectory, setOutputDirectory] = useState(null);
  const [outputName, setOutputName] = useState('rewritten.git');
  const [push, setPush] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const operationIdRef = useRef(null);
  const previewOperationRef = useRef(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const cleanup = window.electronAPI?.onOperationEvent?.((event) => {
      if (event.operationId === operationIdRef.current && ['finished', 'failed', 'canceled'].includes(event.status)) {
        const nextResult = event.result || event;
        setResult(nextResult);
        if (event.operationId === previewOperationRef.current && nextResult.status === 'preview') {
          setPreviewResult(nextResult);
        }
      }
    });
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, []);

  const select = async (method, setter) => {
    try {
      const response = await window.electronAPI[method]();
      if (response.success) {
        setter(response);
        if (method === 'selectRewriteRepository' || method === 'selectRewriteMapping') {
          previewOperationRef.current = null;
          setPreviewResult(null);
        }
      } else if (!response.canceled) {
        setResult({ status: 'failed', message: response.error });
      }
    } catch (error) {
      setResult({ status: 'failed', message: error.message });
    }
  };
  const begin = async (preview) => {
    if (preview) setPreviewResult(null);
    try {
      const response = preview
        ? await window.electronAPI.previewRewrite({ repositoryId: repository.repositoryId, mappingId: mapping.mappingId })
        : await window.electronAPI.startRewrite({
            repositoryId: repository.repositoryId,
            mappingId: mapping.mappingId,
            outputDirectoryId: outputDirectory.directoryId,
            outputName,
            push,
            confirmation,
            previewId: previewOperationRef.current,
          });
      if (!response.success) throw new Error(response.error || 'Unable to start history rewrite');
      operationIdRef.current = response.operationId;
      if (preview) previewOperationRef.current = response.operationId;
      setResult({ status: 'running' });
    } catch (error) {
      setResult({ status: 'failed', message: error.message });
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <Typography.Title level={3}>Rewrite Git history</Typography.Title>
      <Alert type="warning" showIcon title="This changes commit SHAs and can break GitLab MR and pipeline links." />
      <Card className="mt-4">
        <Space orientation="vertical" className="w-full">
          <Button onClick={() => select('selectRewriteRepository', setRepository)}>Select repository</Button>
          {repository && <Typography.Text>{repository.displayPath}</Typography.Text>}
          <Button onClick={() => select('selectRewriteMapping', setMapping)}>Select versioned mapping JSON</Button>
          {mapping && <Typography.Text>{mapping.ruleCount} mapping rules</Typography.Text>}
          <Button disabled={!repository || !mapping} onClick={() => begin(true)}>Preview changed commits and refs</Button>
          <Button onClick={() => select('selectDirectory', setOutputDirectory)}>Select output parent</Button>
          <Input value={outputName} onChange={(event) => setOutputName(event.target.value)} placeholder="Output name" />
          <Space><Switch checked={push} onChange={setPush} /> Push changed refs with exact force-with-lease</Space>
          {push && (
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={confirmationPhrase}
            />
          )}
          <Button
            danger
            disabled={
              !repository || !mapping || !outputDirectory ||
              (push && (!previewResult || confirmation !== confirmationPhrase))
            }
            onClick={() => begin(false)}
          >Rewrite into new mirror</Button>
          {result && (
            <Alert
              type={result.status === 'finished' || result.status === 'preview' ? 'success' : result.status === 'running' ? 'info' : 'error'}
              title={`History rewrite: ${result.status}`}
              description={result.status === 'failed'
                ? [result.error || result.message, result.recovery].filter(Boolean).join('; ')
                : result.changedCommits !== undefined
                  ? `${result.changedCommits} changed commits; ${result.changedRefs?.length || 0} changed refs`
                  : result.message}
            />
          )}
        </Space>
      </Card>
    </div>
  );
}
