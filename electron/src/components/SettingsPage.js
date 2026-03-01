import React, { useState, useEffect, useCallback } from "react";
import {
  Form,
  Input,
  InputNumber,
  Radio,
  Button,
  Card,
  Typography,
  Space,
  App as AntApp,
} from "antd";
import {
  SaveOutlined,
  ApiOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import OAuthDeviceFlow from "./OAuthDeviceFlow";

const { Title } = Typography;

function SettingsPage({ settings, onSave }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const { message } = AntApp.useApp();

  const authMethod = Form.useWatch("authMethod", form);

  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        gitlabUrl: settings.gitlabUrl || "https://gitlab.com",
        authMethod: settings.authMethod || "token",
        token: settings.token || "",
        oauthClientId: settings.oauthClientId || "",
        clonePath: settings.clonePath || "",
        maxConcurrency: settings.maxConcurrency || 4,
        gitAuthMode: settings.gitAuthMode || "url",
      });
    }
  }, [settings, form]);

  const handleSave = async (values) => {
    setSaving(true);
    try {
      if (window.electronAPI?.saveSettings) {
        const result = await window.electronAPI.saveSettings(values);
        if (result && !result.success) {
          message.error(`Failed to save: ${result.error}`);
          return;
        }
      }
      onSave(values);
      message.success("Settings saved");
    } catch (err) {
      message.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const values = form.getFieldsValue();
      if (window.electronAPI?.testConnection) {
        const result = await window.electronAPI.testConnection(values);
        if (result.success) {
          setTestResult({ success: true, username: result.username });
          message.success(`Connected as ${result.username}`);
        } else {
          setTestResult({ success: false, error: result.error });
          message.error(`Connection failed: ${result.error}`);
        }
      }
    } catch (err) {
      setTestResult({ success: false, error: err.message });
      message.error(`Connection failed: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleOAuthSuccess = useCallback(
    async (token) => {
      message.success("OAuth authorization successful");
      const values = form.getFieldsValue();
      values.oauthToken = token;
      if (window.electronAPI?.saveSettings) {
        await window.electronAPI.saveSettings(values);
      }
      onSave(values);
    },
    [form, message, onSave],
  );

  const handleSelectDirectory = async () => {
    try {
      if (window.electronAPI?.selectDirectory) {
        const dir = await window.electronAPI.selectDirectory();
        if (dir) {
          form.setFieldsValue({ clonePath: dir });
        }
      }
    } catch (err) {
      message.error(`Failed to select directory: ${err.message}`);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Title level={3} className="mb-6">
        Settings
      </Title>
      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{
            gitlabUrl: "https://gitlab.com",
            authMethod: "token",
            maxConcurrency: 4,
            gitAuthMode: "url",
          }}
        >
          <Form.Item
            name="gitlabUrl"
            label="GitLab URL"
            rules={[
              { required: true, message: "GitLab URL is required" },
              { type: "url", message: "Please enter a valid URL" },
            ]}
          >
            <Input placeholder="https://gitlab.com" />
          </Form.Item>

          <Form.Item name="authMethod" label="Auth Method">
            <Radio.Group>
              <Radio value="token">Token</Radio>
              <Radio value="oauth">OAuth</Radio>
            </Radio.Group>
          </Form.Item>

          {authMethod === "token" && (
            <Form.Item
              name="token"
              label="Personal Access Token"
              rules={[
                {
                  required: authMethod === "token",
                  message: "Token is required for token auth",
                },
              ]}
            >
              <Input.Password placeholder="glpat-xxxxxxxxxxxx" />
            </Form.Item>
          )}

          {authMethod === "oauth" && (
            <>
              <Form.Item
                name="oauthClientId"
                label="OAuth Client ID"
                rules={[
                  {
                    required: authMethod === "oauth",
                    message: "OAuth Client ID is required",
                  },
                ]}
              >
                <Input placeholder="OAuth Application ID" />
              </Form.Item>
              <Form.Item label="OAuth Authorization">
                <OAuthDeviceFlow onSuccess={handleOAuthSuccess} />
              </Form.Item>
            </>
          )}

          <Form.Item name="clonePath" label="Clone Path">
            <Input
              placeholder="/path/to/repositories"
              addonAfter={
                <FolderOpenOutlined
                  onClick={handleSelectDirectory}
                  className="cursor-pointer"
                  data-testid="select-directory-btn"
                />
              }
            />
          </Form.Item>

          <Form.Item
            name="maxConcurrency"
            label="Max Concurrency"
            rules={[
              {
                type: "number",
                min: 1,
                max: 10,
                message: "Must be between 1 and 10",
              },
            ]}
          >
            <InputNumber min={1} max={10} className="w-full" />
          </Form.Item>

          <Form.Item name="gitAuthMode" label="Git Auth Mode">
            <Radio.Group>
              <Radio value="url">URL</Radio>
              <Radio value="credential_helper">Credential Helper</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={saving}
              >
                Save
              </Button>
              <Button
                icon={<ApiOutlined />}
                loading={testing}
                onClick={handleTestConnection}
                data-testid="test-connection-btn"
              >
                Test Connection
              </Button>
            </Space>
          </Form.Item>

          {testResult && (
            <div
              data-testid="test-result"
              className={`p-3 rounded ${testResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
            >
              {testResult.success
                ? `Connected as ${testResult.username}`
                : `Error: ${testResult.error}`}
            </div>
          )}
        </Form>
      </Card>
    </div>
  );
}

export default SettingsPage;
