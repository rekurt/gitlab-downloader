import React from "react";
import { Layout, Menu } from "antd";
import {
  SettingOutlined,
  CloudDownloadOutlined,
  FolderOutlined,
  SwapOutlined,
  ProjectOutlined,
} from "@ant-design/icons";

const { Sider, Content } = Layout;

const menuItems = [
  { key: "settings", icon: <SettingOutlined />, label: "Settings" },
  { key: "projects", icon: <ProjectOutlined />, label: "Projects" },
  { key: "clone", icon: <CloudDownloadOutlined />, label: "Clone" },
  { key: "repos", icon: <FolderOutlined />, label: "Repositories" },
  { key: "migration", icon: <SwapOutlined />, label: "Migration" },
];

function AppLayout({ currentView, onNavigate, children }) {
  return (
    <Layout className="min-h-screen">
      <Sider
        breakpoint="lg"
        collapsedWidth="64"
        className="!bg-white border-r border-gray-200"
      >
        <div className="h-14 flex items-center justify-center border-b border-gray-200">
          <span className="text-lg font-bold text-gray-800">GitLab Dump</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[currentView]}
          items={menuItems}
          onClick={({ key }) => onNavigate(key)}
          className="border-r-0"
        />
      </Sider>
      <Layout>
        <Content className="p-6 bg-gray-50">{children}</Content>
      </Layout>
    </Layout>
  );
}

export default AppLayout;
