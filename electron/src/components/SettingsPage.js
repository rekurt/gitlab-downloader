import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Space, Typography } from 'antd';
import OAuthDeviceFlow from './OAuthDeviceFlow';

export default function SettingsPage({ settings, onSave }) {
  const [form] = Form.useForm();
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({
      gitlabUrl: settings.gitlabUrl || 'https://gitlab.com',
      oauthClientId: settings.oauthClientId || '',
      oauthScope: settings.oauthScope || 'api',
      maxConcurrency: settings.maxConcurrency || 4,
      sourceToken: '',
      destinationToken: '',
    });
  }, [form, settings]);

  const save = async (values) => {
    setSaving(true);
    setResult(null);
    try {
      const response = await window.electronAPI.saveSettings(values);
      if (!response.success) throw new Error(response.error);
      setResult({ type: 'success', message: 'Settings saved securely' });
      form.setFieldsValue({ sourceToken: '', destinationToken: '' });
      onSave(response.settings);
    } catch (error) {
      setResult({ type: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    try {
      const response = await window.electronAPI.testConnection({
        gitlabUrl: form.getFieldValue('gitlabUrl'),
      });
      setResult(response.success
        ? { type: 'success', message: `Connected as ${response.profile.username}` }
        : { type: 'error', message: response.error });
    } catch (error) {
      setResult({ type: 'error', message: error.message });
    }
  };
  const currentOAuthValues = useCallback(() => {
    const values = form.getFieldsValue(['gitlabUrl', 'oauthClientId', 'oauthScope']);
    return values;
  }, [form]);

  return (
    <div className="max-w-2xl mx-auto">
      <Typography.Title level={3}>Settings</Typography.Title>
      <Card>
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="gitlabUrl" label="GitLab URL" rules={[{ required: true }, { type: 'url' }]}>
            <Input placeholder="https://gitlab.example.com" />
          </Form.Item>
          <Form.Item name="sourceToken" label="Source / clone PAT">
            <Input.Password placeholder={settings.hasSourceToken ? 'Saved securely — leave blank to keep' : 'glpat-…'} />
          </Form.Item>
          <Form.Item name="destinationToken" label="Destination PAT">
            <Input.Password placeholder={settings.hasDestinationToken ? 'Saved securely — leave blank to keep' : 'glpat-…'} />
          </Form.Item>
          <Form.Item name="maxConcurrency" label="Clone concurrency">
            <InputNumber min={1} max={10} />
          </Form.Item>
          <Form.Item name="oauthClientId" label="OAuth client ID"><Input /></Form.Item>
          <Form.Item name="oauthScope" label="OAuth scopes"><Input /></Form.Item>
          <Form.Item label="OAuth authorization">
            <OAuthDeviceFlow
              getValues={currentOAuthValues}
              onAuthorized={(profile) => setResult({ type: 'success', message: `Authorized as ${profile.username}` })}
            />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>Save</Button>
            <Button onClick={testConnection}>Test saved credentials</Button>
          </Space>
        </Form>
        {result && <Alert className="mt-4" type={result.type} showIcon title={result.message} data-testid="settings-result" />}
      </Card>
    </div>
  );
}
