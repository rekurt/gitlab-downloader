import { Layout, Menu } from 'antd';
import {
  CloudDownloadOutlined,
  HistoryOutlined,
  SettingOutlined,
  SwapOutlined,
} from '@ant-design/icons';

const items = [
  { key: 'settings', icon: <SettingOutlined />, label: 'Settings' },
  { key: 'clone', icon: <CloudDownloadOutlined />, label: 'Clone' },
  { key: 'transfer', icon: <SwapOutlined />, label: 'Transfer' },
  { key: 'rewrite', icon: <HistoryOutlined />, label: 'Rewrite history' },
];

export default function AppLayout({ currentView, onNavigate, children }) {
  return (
    <Layout className="min-h-screen">
      <Layout.Sider width={220} className="!bg-white border-r border-gray-200">
        <div className="h-14 flex items-center px-5 border-b border-gray-200 font-semibold">
          GitLab Dump 0.2
        </div>
        <Menu mode="inline" selectedKeys={[currentView]} items={items} onClick={({ key }) => onNavigate(key)} />
      </Layout.Sider>
      <Layout.Content className="p-6 bg-gray-50">{children}</Layout.Content>
    </Layout>
  );
}
