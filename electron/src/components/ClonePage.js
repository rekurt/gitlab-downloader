import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Typography,
  Table,
  Button,
  Switch,
  Tag,
  Progress,
  Card,
  Statistic,
  Space,
  Popconfirm,
  App,
} from "antd";
import {
  CloudDownloadOutlined,
  EyeOutlined,
  StopOutlined,
  CheckCircleOutlined,
  FolderViewOutlined,
} from "@ant-design/icons";

const { Title } = Typography;

const STATUS_COLORS = {
  pending: "default",
  cloning: "processing",
  success: "success",
  updated: "blue",
  skipped: "warning",
  failed: "error",
  new: "green",
  exists: "orange",
};

function ClonePage({ projects = [], settings = {}, onNavigateToRepos }) {
  const { message } = App.useApp();
  const [updateExisting, setUpdateExisting] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [repoStatuses, setRepoStatuses] = useState({});
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState(null);
  const [dryRunData, setDryRunData] = useState(null);
  const [loadingDryRun, setLoadingDryRun] = useState(false);
  const cleanupRef = useRef(null);

  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  const handleDryRun = useCallback(async () => {
    setLoadingDryRun(true);
    setDryRunData(null);
    try {
      const result = await window.electronAPI.dryRunProjects({ projects });
      if (result.success) {
        setDryRunData(result.targets);
      } else {
        message.error(result.error || "Dry run failed");
      }
    } catch (err) {
      message.error(err.message || "Dry run failed");
    } finally {
      setLoadingDryRun(false);
    }
  }, [projects, message]);

  const handleStartClone = useCallback(async () => {
    setCloning(true);
    setDone(false);
    setResults(null);
    setCompleted(0);
    setTotal(projects.length);
    setDryRunData(null);

    const initialStatuses = {};
    projects.forEach((p) => {
      initialStatuses[p.name || p.id] = "pending";
    });
    setRepoStatuses(initialStatuses);

    const cleanup = window.electronAPI.onCloneProgress((data) => {
      setCompleted(data.completed);
      setRepoStatuses((prev) => ({
        ...prev,
        [data.project]: data.result,
      }));
    });
    cleanupRef.current = cleanup;

    try {
      const result = await window.electronAPI.cloneRepositories({
        projects,
        updateExisting,
      });

      if (cleanup) {
        cleanup();
        cleanupRef.current = null;
      }

      if (result.success) {
        setResults(result.results);
        setDone(true);
      } else {
        message.error(result.error || "Clone failed");
        setDone(true);
      }
    } catch (err) {
      if (cleanup) {
        cleanup();
        cleanupRef.current = null;
      }
      message.error(err.message || "Clone failed");
      setDone(true);
    } finally {
      setCloning(false);
    }
  }, [projects, updateExisting, message]);

  const handleCancel = useCallback(async () => {
    try {
      await window.electronAPI.cancelClone();
    } catch {
      // ignore
    }
  }, []);

  const projectTableData = projects.map((p, idx) => ({
    key: p.id || idx,
    name: p.name,
    path_with_namespace: p.path_with_namespace,
    status: repoStatuses[p.name] || "pending",
  }));

  const projectColumns = [
    {
      title: "Project",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "Path",
      dataIndex: "path_with_namespace",
      key: "path",
      ellipsis: true,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status) => (
        <Tag color={STATUS_COLORS[status] || "default"}>{status}</Tag>
      ),
    },
  ];

  const dryRunColumns = [
    {
      title: "Repository",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "Target Path",
      dataIndex: "targetPath",
      key: "targetPath",
      ellipsis: true,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status) => (
        <Tag color={STATUS_COLORS[status] || "default"}>{status}</Tag>
      ),
    },
  ];

  const summary = results
    ? {
        success: results.filter((r) => r.status === "success").length,
        updated: results.filter((r) => r.status === "updated").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "failed").length,
      }
    : null;

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="p-6">
      <Title level={3}>Clone Repositories</Title>

      <div className="mb-4 flex items-center gap-4">
        <span>Update existing repositories:</span>
        <Switch
          data-testid="update-switch"
          checked={updateExisting}
          onChange={setUpdateExisting}
          disabled={cloning}
        />
      </div>

      <div className="mb-4">
        <Space>
          <Button
            data-testid="dry-run-btn"
            icon={<EyeOutlined />}
            onClick={handleDryRun}
            loading={loadingDryRun}
            disabled={cloning || projects.length === 0}
          >
            Preview (Dry Run)
          </Button>
          <Button
            data-testid="start-clone-btn"
            type="primary"
            icon={<CloudDownloadOutlined />}
            onClick={handleStartClone}
            disabled={cloning || projects.length === 0}
            loading={cloning}
          >
            Start Clone
          </Button>
          {cloning && (
            <Popconfirm
              title="Cancel clone operation?"
              description="Repositories already cloned will be kept."
              onConfirm={handleCancel}
              okText="Yes, cancel"
              cancelText="No"
            >
              <Button
                data-testid="cancel-clone-btn"
                danger
                icon={<StopOutlined />}
              >
                Cancel
              </Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      {(cloning || done) && (
        <div className="mb-4" data-testid="progress-section">
          <Progress
            percent={percent}
            status={done ? (summary?.failed > 0 ? "exception" : "success") : "active"}
          />
          <span className="text-sm text-gray-500">
            {completed} / {total} repositories
          </span>
        </div>
      )}

      {dryRunData && !cloning && !done && (
        <div className="mb-4" data-testid="dry-run-results">
          <Title level={5}>Dry Run Results</Title>
          <Table
            dataSource={dryRunData.map((d, idx) => ({ ...d, key: idx }))}
            columns={dryRunColumns}
            size="small"
            pagination={false}
          />
        </div>
      )}

      {!dryRunData && (
        <Table
          dataSource={projectTableData}
          columns={projectColumns}
          size="small"
          pagination={false}
          data-testid="projects-table"
        />
      )}

      {done && summary && (
        <Card className="mt-4" data-testid="summary-card">
          <Title level={5}>
            <CheckCircleOutlined className="mr-2" />
            Clone Complete
          </Title>
          <div className="flex gap-8">
            <Statistic
              title="Cloned"
              value={summary.success}
              valueStyle={{ color: "#52c41a" }}
            />
            <Statistic
              title="Updated"
              value={summary.updated}
              valueStyle={{ color: "#1890ff" }}
            />
            <Statistic
              title="Skipped"
              value={summary.skipped}
              valueStyle={{ color: "#faad14" }}
            />
            <Statistic
              title="Failed"
              value={summary.failed}
              valueStyle={{ color: "#ff4d4f" }}
            />
          </div>
          {onNavigateToRepos && (
            <Button
              data-testid="go-to-repos-btn"
              className="mt-4"
              icon={<FolderViewOutlined />}
              onClick={onNavigateToRepos}
            >
              View Repositories
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

export default ClonePage;
