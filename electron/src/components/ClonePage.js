import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Space, Switch, Typography } from 'antd';

export default function ClonePage() {
  const [directory, setDirectory] = useState(null);
  const [group, setGroup] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState([]);
  const [updateExisting, setUpdateExisting] = useState(false);
  const operationIdRef = useRef(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const cleanup = window.electronAPI?.onOperationEvent?.((event) => {
      if (event.operationId !== operationIdRef.current) return;
      if (['finished', 'partial', 'failed', 'canceled'].includes(event.status)) setResult(event);
    });
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, []);

  const chooseDirectory = async () => {
    try {
      const response = await window.electronAPI.selectDirectory();
      if (response.success) setDirectory(response);
      else if (!response.canceled) setResult({ status: 'failed', message: response.error });
    } catch (error) {
      setResult({ status: 'failed', message: error.message });
    }
  };
  const load = async () => {
    try {
      const response = await window.electronAPI.fetchProjects({ group: group || undefined });
      if (!response.success) throw new Error(response.error || 'Unable to load projects');
      setSessionId(response.sessionId);
      setProjects(response.projects);
      setSelected([]);
    } catch (error) {
      setResult({ status: 'failed', message: error.message });
    }
  };
  const start = async () => {
    try {
      const response = await window.electronAPI.startClone({
        sessionId,
        projectIds: selected,
        directoryId: directory.directoryId,
        updateExisting,
      });
      if (!response.success) throw new Error(response.error || 'Unable to start clone');
      operationIdRef.current = response.operationId;
      setResult({ status: 'running' });
    } catch (error) {
      setResult({ status: 'failed', message: error.message });
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <Typography.Title level={3}>Clone repositories</Typography.Title>
      <Card>
        <Space orientation="vertical" className="w-full">
          <Button onClick={chooseDirectory}>Choose destination</Button>
          {directory && <Typography.Text>{directory.displayPath}</Typography.Text>}
          <Input value={group} onChange={(event) => setGroup(event.target.value)} placeholder="Optional group path" />
          <Button onClick={load}>Load projects</Button>
          <div className="flex flex-col">
            {projects.map((project) => (
              <Checkbox
                key={project.id}
                checked={selected.includes(project.id)}
                onChange={(event) => setSelected((current) => event.target.checked
                  ? [...current, project.id]
                  : current.filter((id) => id !== project.id))}
              >{project.fullPath}</Checkbox>
            ))}
          </div>
          <Space><Switch checked={updateExisting} onChange={setUpdateExisting} /> Fast-forward existing clones</Space>
          <Button type="primary" disabled={!directory || !sessionId || selected.length === 0} onClick={start}>Clone selected</Button>
          {result && <Alert type={result.status === 'finished' ? 'success' : result.status === 'partial' ? 'warning' : result.status === 'running' ? 'info' : 'error'} title={`Clone: ${result.status}`} description={result.message} />}
        </Space>
      </Card>
    </div>
  );
}
