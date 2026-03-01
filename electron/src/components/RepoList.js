import React, { useState, useEffect, useMemo } from 'react';
import {
  Table,
  Input,
  Button,
  Space,
  Tooltip,
  Empty,
  Typography,
  App,
  Tag,
} from 'antd';
import {
  SyncOutlined,
  SwapOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

function RepoList({ clonePath, onSelectRepo, onMigrationStart }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [updatingRepos, setUpdatingRepos] = useState(new Set());
  const { message } = App.useApp();

  const fetchRepos = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!window.electronAPI) {
        setRepos([]);
        return;
      }

      const data = await window.electronAPI.getRepos(clonePath || undefined);
      setRepos(data.repositories || []);
    } catch (err) {
      setError(err.message);
      setRepos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepos();
    const interval = setInterval(fetchRepos, 10000);
    return () => clearInterval(interval);
  }, [clonePath]);

  const handleUpdate = async (repo) => {
    setUpdatingRepos((prev) => new Set([...prev, repo.path]));
    try {
      const project = {
        name: repo.name,
        path_with_namespace: repo.name,
        http_url_to_repo: repo.url,
      };
      await window.electronAPI.cloneRepositories({
        projects: [project],
        updateExisting: true,
      });
      message.success(`${repo.name} updated`);
      fetchRepos();
    } catch (err) {
      message.error(`Failed to update ${repo.name}: ${err.message}`);
    } finally {
      setUpdatingRepos((prev) => {
        const next = new Set(prev);
        next.delete(repo.path);
        return next;
      });
    }
  };

  const handleMigrate = (repo) => {
    if (onSelectRepo) onSelectRepo(repo);
    if (onMigrationStart) onMigrationStart(repo);
  };

  const handleOpenFolder = async (repo) => {
    try {
      await window.electronAPI.openPath(repo.path);
    } catch (err) {
      message.error(`Failed to open folder: ${err.message}`);
    }
  };

  const filteredRepos = useMemo(() => {
    if (!searchText) return repos;
    const lower = searchText.toLowerCase();
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        (r.url && r.url.toLowerCase().includes(lower)),
    );
  }, [repos, searchText]);

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: 'Remote URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url) => (
        <Text copyable={{ text: url }} className="text-xs">
          {url}
        </Text>
      ),
    },
    {
      title: 'Local Path',
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
      render: (p) => (
        <Text copyable={{ text: p }} className="text-xs">
          {p}
        </Text>
      ),
    },
    {
      title: 'Last Updated',
      dataIndex: 'last_updated',
      key: 'last_updated',
      width: 180,
      sorter: (a, b) => {
        const da = a.last_updated ? new Date(a.last_updated) : new Date(0);
        const db = b.last_updated ? new Date(b.last_updated) : new Date(0);
        return da - db;
      },
      render: (val) =>
        val ? (
          <Tag>{new Date(val).toLocaleString()}</Tag>
        ) : (
          <Tag color="default">Unknown</Tag>
        ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space>
          <Tooltip title="Update (pull)">
            <Button
              type="text"
              size="small"
              icon={<SyncOutlined spin={updatingRepos.has(record.path)} />}
              loading={updatingRepos.has(record.path)}
              onClick={() => handleUpdate(record)}
              data-testid={`update-btn-${record.name}`}
            />
          </Tooltip>
          <Tooltip title="Migrate">
            <Button
              type="text"
              size="small"
              icon={<SwapOutlined />}
              onClick={() => handleMigrate(record)}
              data-testid={`migrate-btn-${record.name}`}
            />
          </Tooltip>
          <Tooltip title="Open folder">
            <Button
              type="text"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => handleOpenFolder(record)}
              data-testid={`open-btn-${record.name}`}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  if (error) {
    return (
      <div className="p-6" data-testid="repo-list-error">
        <Title level={4}>Local Repositories</Title>
        <div className="text-red-500 mb-4">
          Error loading repositories: {error}
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchRepos}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6" data-testid="repo-list">
      <div className="flex items-center justify-between mb-4">
        <Title level={4} className="!mb-0">
          Local Repositories
        </Title>
        <Space>
          <Text type="secondary">{repos.length} repositories</Text>
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchRepos}
            loading={loading}
            data-testid="refresh-btn"
          >
            Refresh
          </Button>
        </Space>
      </div>

      <Input.Search
        placeholder="Search by name or URL..."
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        className="mb-4"
        allowClear
        data-testid="search-input"
      />

      <Table
        columns={columns}
        dataSource={filteredRepos}
        rowKey="path"
        loading={loading}
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: true }}
        locale={{
          emptyText: (
            <Empty
              description="No repositories found. Clone projects first."
              data-testid="empty-state"
            />
          ),
        }}
      />
    </div>
  );
}

export default RepoList;
