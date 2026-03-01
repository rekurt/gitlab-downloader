import React, { useState, useEffect, useCallback } from "react";
import { Button, Typography, Flex, Spin, Alert, App as AntApp } from "antd";
import {
  CheckCircleOutlined,
  CopyOutlined,
  LoginOutlined,
} from "@ant-design/icons";

const { Text, Link, Title } = Typography;

function OAuthDeviceFlow({ onSuccess }) {
  const [status, setStatus] = useState("idle");
  const [verificationUri, setVerificationUri] = useState("");
  const [userCode, setUserCode] = useState("");
  const [verificationUriComplete, setVerificationUriComplete] = useState("");
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const { message } = AntApp.useApp();

  useEffect(() => {
    if (status !== "pending") return;

    const cleanup = window.electronAPI?.onOAuthProgress?.((data) => {
      if (data.status === "success") {
        setStatus("success");
        if (onSuccess) {
          onSuccess(data.token);
        }
      } else if (data.status === "error") {
        setStatus("error");
        setError(data.message || "Authorization failed");
      }
    });

    return () => {
      if (typeof cleanup === "function") {
        cleanup();
      }
    };
  }, [status, onSuccess]);

  useEffect(() => {
    if (status !== "success") return;
    const timer = setTimeout(() => {
      setStatus("idle");
    }, 3000);
    return () => clearTimeout(timer);
  }, [status]);

  const handleStart = useCallback(async () => {
    setStatus("pending");
    setError(null);
    setCopied(false);

    try {
      const result = await window.electronAPI?.startOAuthDeviceFlow?.();
      if (!result) {
        setStatus("error");
        setError("electronAPI not available");
        return;
      }
      if (!result.success) {
        setStatus("error");
        setError(result.error || "Failed to start OAuth flow");
        return;
      }

      setVerificationUri(result.verificationUri || "");
      setUserCode(result.userCode || "");
      setVerificationUriComplete(result.verificationUriComplete || "");
    } catch (err) {
      setStatus("error");
      setError(err.message || "Failed to start OAuth flow");
    }
  }, []);

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      message.success("Code copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      message.error("Failed to copy code");
    }
  }, [userCode, message]);

  const handleOpenLink = useCallback(() => {
    const url = verificationUriComplete || verificationUri;
    if (url) {
      window.open(url, "_blank");
    }
  }, [verificationUri, verificationUriComplete]);

  if (status === "idle") {
    return (
      <Button
        icon={<LoginOutlined />}
        onClick={handleStart}
        data-testid="start-oauth-btn"
      >
        Authorize with OAuth
      </Button>
    );
  }

  if (status === "success") {
    return (
      <Alert
        type="success"
        showIcon
        icon={<CheckCircleOutlined />}
        title="Authorization successful"
        data-testid="oauth-success"
      />
    );
  }

  if (status === "error") {
    return (
      <Flex vertical className="w-full">
        <Alert
          type="error"
          title={error || "Authorization failed"}
          data-testid="oauth-error"
        />
        <Button
          onClick={handleStart}
          data-testid="oauth-retry-btn"
          className="mt-2"
        >
          Retry
        </Button>
      </Flex>
    );
  }

  // status === "pending"
  return (
    <Flex vertical className="w-full" data-testid="oauth-pending">
      {userCode && (
        <div className="text-center p-4 bg-gray-50 rounded">
          <Text type="secondary" className="block mb-2">
            Enter this code in your browser:
          </Text>
          <Title level={3} className="mb-2" data-testid="oauth-user-code">
            {userCode}
          </Title>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={handleCopyCode}
            data-testid="copy-code-btn"
          >
            {copied ? "Copied!" : "Copy Code"}
          </Button>
        </div>
      )}

      {(verificationUriComplete || verificationUri) && (
        <div className="text-center mt-3">
          <Text type="secondary">Open authorization page: </Text>
          <Link
            onClick={handleOpenLink}
            data-testid="oauth-link"
          >
            {verificationUriComplete || verificationUri}
          </Link>
        </div>
      )}

      <div className="text-center p-2">
        <Spin data-testid="oauth-spinner" />
        <Text type="secondary" className="block mt-2">
          Waiting for authorization...
        </Text>
      </div>
    </Flex>
  );
}

export default OAuthDeviceFlow;
