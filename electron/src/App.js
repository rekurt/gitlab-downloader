import React, { useEffect, useState, useCallback } from "react";
import { Spin } from "antd";
import AppLayout from "./components/AppLayout";
import SettingsPage from "./components/SettingsPage";
import ProjectsPage from "./components/ProjectsPage";
import ClonePage from "./components/ClonePage";
import RepoList from "./components/RepoList";
import MigrationWizard from "./components/MigrationWizard";

function App() {
  const [currentView, setCurrentView] = useState("settings");
  const [settings, setSettings] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [selectedProjects, setSelectedProjects] = useState([]);
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

  const handleCloneSelected = useCallback((projects) => {
    setSelectedProjects(projects);
    setCurrentView("clone");
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
        <ProjectsPage
          settings={settings}
          onCloneSelected={handleCloneSelected}
        />
      )}

      {currentView === "clone" && (
        <ClonePage
          projects={selectedProjects}
          settings={settings}
          onNavigateToRepos={() => setCurrentView("repos")}
        />
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

      {currentView === "migration" && !selectedRepo && (
        <div className="p-6 text-center">
          <p className="mb-4 text-gray-500">
            Select a repository to migrate from the Repositories tab.
          </p>
          <button
            className="text-blue-500 underline"
            onClick={() => setCurrentView("repos")}
          >
            Go to Repositories
          </button>
        </div>
      )}
    </AppLayout>
  );
}

export default App;
