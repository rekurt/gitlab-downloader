import React, { useState } from 'react';
import {
  Form,
  Input,
  Select,
  Button,
  Space,
  Typography,
  Alert,
  Divider,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

function AuthorMapper({ onSave, onCancel }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      setError(null);

      const entries = values.mappings || [];

      const authorMappings = entries
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

      const committerMappings = entries
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
      if (err.errorFields) {
        // Form validation error - don't set custom error
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <Title level={4}>Author Mapping</Title>
        <Text type="secondary">Map original authors to new identities</Text>
      </div>

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

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          mappings: [
            {
              type: 'author',
              original_name: '',
              original_email: '',
              new_name: '',
              new_email: '',
            },
          ],
        }}
      >
        <Form.List name="mappings">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <div
                  key={key}
                  className="p-4 mb-4 border border-gray-200 rounded-lg bg-gray-50"
                >
                  <div className="flex items-center justify-between mb-3">
                    <Form.Item
                      {...restField}
                      name={[name, 'type']}
                      label="Type"
                      className="mb-0"
                      rules={[{ required: true, message: 'Type is required' }]}
                    >
                      <Select style={{ width: 150 }}>
                        <Select.Option value="author">Author</Select.Option>
                        <Select.Option value="committer">Committer</Select.Option>
                      </Select>
                    </Form.Item>
                    {fields.length > 1 && (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(name)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>

                  <div className="flex gap-4 items-start">
                    <div className="flex-1">
                      <Text strong className="block mb-2">Original</Text>
                      <Space direction="vertical" className="w-full">
                        <Form.Item
                          {...restField}
                          name={[name, 'original_name']}
                          rules={[{ required: true, message: 'Original name is required' }]}
                          className="mb-2"
                        >
                          <Input placeholder="John Doe" />
                        </Form.Item>
                        <Form.Item
                          {...restField}
                          name={[name, 'original_email']}
                          rules={[{ required: true, message: 'Original email is required' }]}
                          className="mb-0"
                        >
                          <Input placeholder="john@example.com" />
                        </Form.Item>
                      </Space>
                    </div>

                    <div className="flex items-center pt-8">
                      <Text type="secondary" className="text-xl">&rarr;</Text>
                    </div>

                    <div className="flex-1">
                      <Text strong className="block mb-2">New</Text>
                      <Space direction="vertical" className="w-full">
                        <Form.Item
                          {...restField}
                          name={[name, 'new_name']}
                          rules={[{ required: true, message: 'New name is required' }]}
                          className="mb-2"
                        >
                          <Input placeholder="John Smith" />
                        </Form.Item>
                        <Form.Item
                          {...restField}
                          name={[name, 'new_email']}
                          rules={[{ required: true, message: 'New email is required' }]}
                          className="mb-0"
                        >
                          <Input placeholder="john@newhost.com" />
                        </Form.Item>
                      </Space>
                    </div>
                  </div>
                </div>
              ))}

              <Form.Item>
                <Button
                  type="dashed"
                  onClick={() =>
                    add({
                      type: 'author',
                      original_name: '',
                      original_email: '',
                      new_name: '',
                      new_email: '',
                    })
                  }
                  block
                  icon={<PlusOutlined />}
                >
                  Add Mapping
                </Button>
              </Form.Item>
            </>
          )}
        </Form.List>
      </Form>

      <Divider />

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="primary" onClick={handleSave} loading={loading}>
          Save Mappings
        </Button>
      </div>
    </div>
  );
}

export default AuthorMapper;
