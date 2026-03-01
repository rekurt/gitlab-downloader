import React, { useState, useMemo, useCallback } from "react";
import {
  Button,
  Table,
  Input,
  Space,
  Typography,
  App,
  Tag,
} from "antd";
import {
  CloudDownloadOutlined,
  SearchOutlined,
  StopOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;

function ProjectsPage({ settings, onCloneSelected }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [groupOverride, setGroupOverride] = useState("");
  const [error, setError] = useState(null);
  const { message } = App.useApp();

  const handleLoadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProjects([]);
    setSelectedRowKeys([]);

    try {
      const params = {};
      const group = groupOverride || settings?.group;
      if (group) {
        params.group = group;
      }

      const result = await window.electronAPI.fetchProjects(params);
      if (result.success) {
        setProjects(result.projects || []);
        message.success(
          `Loaded ${(result.projects || []).length} projects`,
        );
      } else {
        setError(result.error);
        message.error(result.error || "Failed to fetch projects");
      }
    } catch (err) {
      setError(err.message);
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [groupOverride, settings?.group, message]);

  const handleCancel = useCallback(async () => {
    try {
      await window.electronAPI.cancelFetchProjects();
    } catch {
      // ignore
    }
  }, []);

  const handleCloneSelected = useCallback(() => {
    const selected = projects.filter((p) =>
      selectedRowKeys.includes(p.id),
    );
    if (selected.length > 0 && onCloneSelected) {
      onCloneSelected(selected);
    }
  }, [projects, selectedRowKeys, onCloneSelected]);

  const filteredProjects = useMemo(() => {
    if (!searchText) return projects;
    const lower = searchText.toLowerCase();
    return projects.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(lower) ||
        (p.path_with_namespace || "").toLowerCase().includes(lower),
    );
  }, [projects, searchText]);

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => (a.name || "").localeCompare(b.name || ""),
    },
    {
      title: "Path",
      dataIndex: "path_with_namespace",
      key: "path_with_namespace",
      ellipsis: true,
    },
    {
      title: "URL",
      dataIndex: "http_url_to_repo",
      key: "http_url_to_repo",
      ellipsis: true,
      render: (url) => (
        <Text copyable={{ text: url }} className="text-xs">
          {url}
        </Text>
      ),
    },
    {
      title: "Last Activity",
      dataIndex: "last_activity_at",
      key: "last_activity_at",
      width: 160,
      sorter: (a, b) =>
        new Date(a.last_activity_at || 0) -
        new Date(b.last_activity_at || 0),
      render: (date) => {
        if (!date) return <Tag>Unknown</Tag>;
        return new Date(date).toLocaleDateString();
      },
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  };

  const groupInput = !settings?.group ? (
    <Input
      placeholder="Group ID or path (optional)"
      value={groupOverride}
      onChange={(e) => setGroupOverride(e.target.value)}
      className="w-64"
      data-testid="group-input"
    />
  ) : null;

  return (
    <div className="p-6">
      <Title level={3}>Projects</Title>

      <Space className="mb-4" wrap>
        {groupInput}
        <Button
          type="primary"
          icon={<CloudDownloadOutlined />}
          loading={loading}
          onClick={handleLoadProjects}
          data-testid="load-projects-btn"
        >
          Load Projects
        </Button>
        {loading && (
          <Button
            icon={<StopOutlined />}
            onClick={handleCancel}
            danger
            data-testid="cancel-fetch-btn"
          >
            Cancel
          </Button>
        )}
      </Space>

      {error && (
        <div className="mb-4">
          <Text type="danger">{error}</Text>
        </div>
      )}

      <Input
        placeholder="Search projects by name..."
        prefix={<SearchOutlined />}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        className="mb-4 max-w-md"
        allowClear
        data-testid="search-input"
      />

      <Table
        rowSelection={rowSelection}
        columns={columns}
        dataSource={filteredProjects}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 50, showSizeChanger: true }}
        locale={{ emptyText: projects.length === 0
          ? "No projects loaded. Click \"Load Projects\" to fetch from GitLab."
          : "No projects match the search filter." }}
      />

      <div className="mt-4 flex items-center gap-4">
        <Text>
          {selectedRowKeys.length} of {filteredProjects.length} projects
          selected
        </Text>
        <Button
          type="primary"
          icon={<CloudDownloadOutlined />}
          disabled={selectedRowKeys.length === 0}
          onClick={handleCloneSelected}
          data-testid="clone-selected-btn"
        >
          Clone Selected
        </Button>
      </div>
    </div>
  );
}

export default ProjectsPage;
