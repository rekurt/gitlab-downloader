import React, { useEffect, useState, useCallback } from "react";
import { Spin } from "antd";
import AppLayout from "./components/AppLayout";
import SettingsPage from "./components/SettingsPage";
import RepoList from "./components/RepoList";
import MigrationWizard from "./components/MigrationWizard";

function App() {
  const [currentView, setCurrentView] = useState("settings");
  const [settings, setSettings] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        if (window.electronAPI?.loadSettings) {
          const loaded = await window.electronAPI.loadSettings();
          setSettings(loaded || {});
        } else {
          setSettings({});
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
        setSettings({});
      } finally {
        setReady(true);
      }
    }
    init();
  }, []);

  const handleNavigate = useCallback(
    (view) => {
      if (view !== "migration") {
        setSelectedRepo(null);
      }
      setCurrentView(view);
    },
    [],
  );

  const handleSettingsSaved = useCallback((newSettings) => {
    setSettings(newSettings);
  }, []);

  const handleMigrationStart = useCallback((repo) => {
    setSelectedRepo(repo);
    setCurrentView("migration");
  }, []);

  const handleMigrationComplete = useCallback(() => {
    setCurrentView("repos");
    setSelectedRepo(null);
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spin size="large" />
      </div>
    );
  }

  const clonePath = settings?.clonePath || "";

  return (
    <AppLayout currentView={currentView} onNavigate={handleNavigate}>
      {currentView === "settings" && (
        <SettingsPage settings={settings} onSave={handleSettingsSaved} />
      )}

      {currentView === "projects" && (
        <div className="text-gray-500">Projects view (coming soon)</div>
      )}

      {currentView === "clone" && (
        <div className="text-gray-500">Clone view (coming soon)</div>
      )}

      {currentView === "repos" && (
        <RepoList
          clonePath={clonePath}
          onSelectRepo={setSelectedRepo}
          onMigrationStart={handleMigrationStart}
        />
      )}

      {currentView === "migration" && selectedRepo && (
        <MigrationWizard
          repo={selectedRepo}
          onComplete={handleMigrationComplete}
          onCancel={() => {
            setCurrentView("repos");
            setSelectedRepo(null);
          }}
        />
      )}
    </AppLayout>
  );
}

export default App;
