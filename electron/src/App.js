import { useEffect, useState } from 'react';
import { Alert, Spin } from 'antd';
import AppLayout from './components/AppLayout';
import ClonePage from './components/ClonePage';
import HistoryRewritePage from './components/HistoryRewritePage';
import SettingsPage from './components/SettingsPage';
import TransferPage from './components/TransferPage';

export default function App() {
  const [view, setView] = useState('settings');
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    window.electronAPI.loadSettings()
      .then(setSettings)
      .catch((caught) => {
        setError(caught.message);
        setSettings({});
      });
  }, []);
  if (!settings) return <Spin fullscreen />;
  return (
    <AppLayout currentView={view} onNavigate={setView}>
      {error && <Alert type="error" title={error} />}
      {view === 'settings' && <SettingsPage settings={settings} onSave={(saved) => setSettings((current) => ({ ...current, ...saved }))} />}
      {view === 'clone' && <ClonePage />}
      {view === 'transfer' && <TransferPage />}
      {view === 'rewrite' && <HistoryRewritePage />}
    </AppLayout>
  );
}
