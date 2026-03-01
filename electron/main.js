const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const isDev = require("electron-is-dev");
const os = require("os");
const fs = require("fs");

let mainWindow;

/**
 * Lazily loaded core library modules (ESM).
 * We use dynamic import() because lib/ is an ESM package.
 */
let _coreLib = null;
async function getCoreLib() {
  if (!_coreLib) {
    _coreLib = await import("@gitlab-dump/core");
  }
  return _coreLib;
}

/**
 * Lazily loaded electron-store.
 */
const Store = require("electron-store");
let _store = null;
function getStore() {
  if (!_store) {
    _store = new Store({ name: "settings" });
  }
  return _store;
}

/**
 * Find git repositories recursively under a base directory.
 * Returns an array of { name, path, url, last_updated } objects
 * for the renderer's RepoList component.
 */
function findGitRepos(basePath, maxDepth = 10) {
  const repos = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    try {
      const gitDir = path.join(dir, ".git");
      if (fs.existsSync(gitDir)) {
        let url = "";
        try {
          const configPath = path.join(gitDir, "config");
          const configContent = fs.readFileSync(configPath, "utf-8");
          const match = configContent.match(
            /\[remote "origin"\][^[]*url\s*=\s*(.+)/m,
          );
          if (match) url = match[1].trim();
        } catch {
          /* ignore */
        }

        let lastUpdated = null;
        try {
          const stats = fs.statSync(path.join(gitDir, "FETCH_HEAD"));
          lastUpdated = stats.mtime.toISOString();
        } catch {
          try {
            const stats = fs.statSync(path.join(gitDir, "HEAD"));
            lastUpdated = stats.mtime.toISOString();
          } catch {
            /* ignore */
          }
        }

        repos.push({
          name: path.basename(dir),
          path: dir,
          url,
          last_updated: lastUpdated,
        });
        return; // don't recurse into .git repos
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name === "node_modules" || entry.name.startsWith("."))
          continue;
        const full = path.join(dir, entry.name);
        walk(full, depth + 1);
      }
    } catch {
      // Permission errors or broken symlinks
    }
  }

  if (fs.existsSync(basePath)) {
    walk(basePath, 0);
  }
  return repos;
}

/**
 * Resolve clone path from env, expanding ~ and resolving relative paths.
 */
function resolveClonePath() {
  let clonePath = process.env.CLONE_PATH || "repositories";
  if (
    clonePath.startsWith("~/") ||
    clonePath.startsWith("~\\") ||
    clonePath === "~"
  ) {
    clonePath = path.join(os.homedir(), clonePath.slice(1));
  }
  return path.resolve(os.homedir(), clonePath);
}

/**
 * Create the main window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  const startUrl = isDev
    ? "http://localhost:8000"
    : `file://${path.join(__dirname, "dist", "index.html")}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * Create the application menu
 */
function createMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Exit",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Active migration abort controllers, keyed by migration ID.
 */
const activeMigrations = new Map();

/**
 * Active fetch operations abort controller (only one at a time).
 */
let activeFetchAc = null;

/**
 * Active clone operation abort controller (only one at a time).
 */
let activeCloneAc = null;

/**
 * IPC handlers for frontend communication
 */
function setupIpcHandlers() {
  // Get clone path
  ipcMain.handle("get-clone-path", () => {
    return resolveClonePath();
  });

  // Get list of git repositories under clone path
  ipcMain.handle("get-repos", (_event, clonePath) => {
    const resolvedPath = clonePath || resolveClonePath();
    const repos = findGitRepos(resolvedPath);
    return { repositories: repos };
  });

  // Get author/committer mappings from a config file
  ipcMain.handle("get-author-mappings", async (_event, configPath) => {
    try {
      const lib = await getCoreLib();
      if (configPath) {
        const mappings = await lib.loadMappings(configPath);
        return { success: true, data: mappings };
      }
      return {
        success: true,
        data: { authorMappings: {}, committerMappings: {} },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Save author/committer mappings to a config file
  ipcMain.handle(
    "save-author-mappings",
    async (_event, { configPath, authorMappings, committerMappings }) => {
      try {
        const savePath =
          configPath ||
          path.join(
            app.getPath("userData"),
            "author_mappings.json",
          );
        const lib = await getCoreLib();
        await lib.saveMappings(
          savePath,
          authorMappings || {},
          committerMappings || {},
        );
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  // Get migration config from a repository path
  ipcMain.handle("get-config", async (_event, repoPath) => {
    try {
      const lib = await getCoreLib();
      const config = await lib.discoverConfig(repoPath);
      if (config) {
        return { success: true, data: config };
      }
      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Save migration config to a repository
  ipcMain.handle("save-config", async (_event, { repoPath, config }) => {
    try {
      const lib = await getCoreLib();
      await lib.saveConfigToRepo(repoPath, config);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Start a migration - runs asynchronously, sends progress via IPC events
  ipcMain.handle("start-migration", async (event, migrationConfig) => {
    const migrationId = `mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const lib = await getCoreLib();
      const ac = new AbortController();
      activeMigrations.set(migrationId, ac);

      const { repoPath, authorMappings, committerMappings } = migrationConfig;

      const config = {
        source_repos_path: repoPath,
        target_hosting_url: migrationConfig.targetHostingUrl || "",
        target_token: migrationConfig.targetToken || "",
        author_mappings: authorMappings || {},
        committer_mappings: committerMappings || {},
      };

      const executor = new lib.MigrationExecutor(config);
      const messages = [];

      executor.on("progress", (msg) => {
        messages.push(msg);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("migration-progress", {
            migrationId,
            status: "running",
            progress: -1,
            current_task: msg,
            messages: messages.slice(-20),
          });
        }
      });

      executor.on("error", (msg) => {
        messages.push(`Error: ${msg}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("migration-progress", {
            migrationId,
            status: "error",
            progress: -1,
            current_task: msg,
            messages: messages.slice(-20),
          });
        }
      });

      // Run migration asynchronously
      const runMigration = async () => {
        try {
          const success = await executor.migrateRepository(repoPath, {
            authorMappings,
            committerMappings,
            signal: ac.signal,
          });

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("migration-progress", {
              migrationId,
              status: success ? "completed" : "failed",
              progress: 100,
              current_task: success
                ? "Migration completed"
                : "Migration failed",
              messages: messages.slice(-20),
              error: success ? null : "Migration encountered errors",
            });
          }
        } catch (err) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("migration-progress", {
              migrationId,
              status: "failed",
              progress: 100,
              current_task: "Migration failed",
              messages: messages.slice(-20),
              error: err.message,
            });
          }
        } finally {
          activeMigrations.delete(migrationId);
        }
      };

      // Fire and forget - progress sent via IPC events
      runMigration();

      return { success: true, migrationId };
    } catch (err) {
      activeMigrations.delete(migrationId);
      return { success: false, error: err.message };
    }
  });

  // Cancel a running migration
  ipcMain.handle("cancel-migration", (_event, migrationId) => {
    const ac = activeMigrations.get(migrationId);
    if (ac) {
      ac.abort();
      activeMigrations.delete(migrationId);
      return { success: true };
    }
    return { success: false, error: "Migration not found" };
  });

  // Request graceful shutdown
  ipcMain.handle("request-shutdown", async () => {
    // Abort all active migrations
    for (const [, ac] of activeMigrations) {
      ac.abort();
    }
    activeMigrations.clear();
    app.quit();
    return { success: true };
  });

  // Load settings from electron-store
  ipcMain.handle("load-settings", async () => {
    const store = getStore();
    return store.get("settings", {});
  });

  // Save settings to electron-store (with Zod validation)
  ipcMain.handle("save-settings", async (_event, settings) => {
    try {
      const lib = await getCoreLib();
      // Validate URL if provided
      if (settings.gitlabUrl && !lib.validateGitlabUrl(settings.gitlabUrl)) {
        return { success: false, error: "Invalid GitLab URL" };
      }
      const store = getStore();
      store.set("settings", settings);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Test connection to GitLab instance
  ipcMain.handle("test-connection", async (_event, settings) => {
    try {
      const lib = await getCoreLib();
      const url = (settings.gitlabUrl || "").replace(/\/+$/, "");
      const token = settings.token || null;
      if (!url) {
        return { success: false, error: "GitLab URL is required" };
      }
      const config = lib.GitlabConfigSchema.parse({
        url,
        token,
        maxRetries: 1,
        requestTimeout: 10,
      });
      const apiUrl = `${config.url}/api/v4/user`;
      const data = await lib.fetchJson(apiUrl, {}, "test connection", config);
      if (data && data.username) {
        return { success: true, username: data.username };
      }
      return { success: false, error: "Unexpected response from GitLab" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Start OAuth Device Flow
  ipcMain.handle("start-oauth-device-flow", async (event) => {
    try {
      const lib = await getCoreLib();
      const store = getStore();
      const settings = store.get("settings", {});
      const url = (settings.gitlabUrl || "").replace(/\/+$/, "");
      const oauthClientId = settings.oauthClientId || "";

      if (!url) {
        return { success: false, error: "GitLab URL is required" };
      }
      if (!oauthClientId) {
        return { success: false, error: "OAuth Client ID is required" };
      }

      const config = lib.GitlabConfigSchema.parse({
        url,
        authMethod: "oauth",
        oauthClientId,
        oauthScope: settings.oauthScope || "read_api read_repository",
      });

      const deviceData = await lib.deviceAuthorize(config);

      // Start polling in background
      const pollPromise = lib.pollDeviceToken(
        config,
        String(deviceData.device_code || ""),
        parseInt(deviceData.interval, 10) || 5,
        parseInt(deviceData.expires_in, 10) || 300,
      );

      pollPromise
        .then(async (tokenPayload) => {
          const normalized = lib.normalizeOAuthPayload(config, tokenPayload);
          // Save token to settings
          const currentSettings = store.get("settings", {});
          currentSettings.oauthToken = normalized.access_token;
          store.set("settings", currentSettings);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("oauth-progress", {
              status: "success",
              token: normalized.access_token,
            });
          }
        })
        .catch((err) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("oauth-progress", {
              status: "error",
              message: err.message,
            });
          }
        });

      return {
        success: true,
        verificationUri: String(deviceData.verification_uri || ""),
        userCode: String(deviceData.user_code || ""),
        verificationUriComplete: String(
          deviceData.verification_uri_complete || "",
        ),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Open directory picker dialog
  ipcMain.handle("select-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // Open a path in the system file manager
  ipcMain.handle("open-path", async (_event, targetPath) => {
    if (!targetPath) {
      return { success: false, error: "Path is required" };
    }
    try {
      const resolvedBase = path.resolve(resolveClonePath());
      const resolvedTarget = path.resolve(targetPath);
      if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
        return { success: false, error: "Path is outside clone directory" };
      }
      const result = await shell.openPath(targetPath);
      if (result) {
        return { success: false, error: result };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Fetch projects from GitLab (group or user membership)
  ipcMain.handle("fetch-projects", async (_event, { group } = {}) => {
    try {
      const lib = await getCoreLib();
      const store = getStore();
      const settings = store.get("settings", {});
      const url = (settings.gitlabUrl || "").replace(/\/+$/, "");
      const token = settings.oauthToken || settings.token || null;

      if (!url) {
        return { success: false, error: "GitLab URL is required" };
      }
      if (!token) {
        return { success: false, error: "Authentication token is required" };
      }

      const groupValue = group || settings.group || null;
      const config = lib.GitlabConfigSchema.parse({
        url,
        token,
        group: groupValue || undefined,
        maxRetries: 3,
        requestTimeout: 30,
      });

      const ac = new AbortController();
      activeFetchAc = ac;

      let projects;
      if (groupValue) {
        const metadata = await lib.fetchGroupMetadata(config, {
          signal: ac.signal,
        });
        projects = await lib.getAllProjects(
          config,
          metadata.full_path || groupValue,
          { signal: ac.signal },
        );
      } else {
        projects = await lib.getUserProjects(config, { signal: ac.signal });
      }

      activeFetchAc = null;
      return { success: true, projects };
    } catch (err) {
      activeFetchAc = null;
      if (err?.name === "AbortError") {
        return { success: false, error: "Fetch cancelled" };
      }
      return { success: false, error: err.message };
    }
  });

  // Cancel active project fetch
  ipcMain.handle("cancel-fetch-projects", () => {
    if (activeFetchAc) {
      activeFetchAc.abort();
      activeFetchAc = null;
      return { success: true };
    }
    return { success: false, error: "No active fetch" };
  });

  // Clone repositories with progress reporting
  ipcMain.handle("clone-repositories", async (_event, { projects, updateExisting }) => {
    if (!projects || projects.length === 0) {
      return { success: false, error: "No projects to clone" };
    }

    try {
      const lib = await getCoreLib();
      const store = getStore();
      const settings = store.get("settings", {});
      const url = (settings.gitlabUrl || "").replace(/\/+$/, "");
      const token = settings.oauthToken || settings.token || null;
      const clonePath = settings.clonePath || resolveClonePath();

      if (!url) {
        return { success: false, error: "GitLab URL is required" };
      }
      if (!token) {
        return { success: false, error: "Authentication token is required" };
      }

      const config = lib.GitlabConfigSchema.parse({
        url,
        token,
        clonePath,
        updateExisting: !!updateExisting,
        maxConcurrency: settings.maxConcurrency || 5,
        gitAuthMode: settings.gitAuthMode || "url",
      });

      // Normalize group_path from path_with_namespace to ensure consistent
      // clone paths regardless of how projects were fetched (group vs user mode)
      for (const project of projects) {
        const pwn = String(project.path_with_namespace || "");
        project.group_path = pwn.includes("/")
          ? pwn.slice(0, pwn.lastIndexOf("/"))
          : "";
      }

      const ac = new AbortController();
      activeCloneAc = ac;

      let completed = 0;
      const total = projects.length;

      const results = await lib.cloneAllRepositories(projects, config, {
        signal: ac.signal,
        onResult: (result) => {
          completed++;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("clone-progress", {
              project: result.name,
              result: result.status,
              message: result.message,
              completed,
              total,
            });
          }
        },
      });

      activeCloneAc = null;
      return { success: true, results };
    } catch (err) {
      activeCloneAc = null;
      if (err?.name === "AbortError") {
        return { success: false, error: "Clone cancelled" };
      }
      return { success: false, error: err.message };
    }
  });

  // Cancel active clone operation
  ipcMain.handle("cancel-clone", () => {
    if (activeCloneAc) {
      activeCloneAc.abort();
      activeCloneAc = null;
      return { success: true };
    }
    return { success: false, error: "No active clone" };
  });

  // Dry-run: compute clone targets without executing
  ipcMain.handle("dry-run-projects", async (_event, { projects }) => {
    if (!projects || projects.length === 0) {
      return { success: true, targets: [] };
    }

    try {
      const lib = await getCoreLib();
      const store = getStore();
      const settings = store.get("settings", {});
      const clonePath = settings.clonePath || resolveClonePath();

      const config = { clonePath };

      // Normalize group_path (same logic as clone-repositories)
      for (const project of projects) {
        const pwn = String(project.path_with_namespace || "");
        project.group_path = pwn.includes("/")
          ? pwn.slice(0, pwn.lastIndexOf("/"))
          : "";
      }

      const targets = projects.map((project) => {
        const { repoName, targetPath } = lib.buildCloneTarget(project, config);
        const exists = fs.existsSync(targetPath);
        return {
          name: repoName,
          targetPath,
          status: exists ? "exists" : "new",
        };
      });

      return { success: true, targets };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

/**
 * App event handlers
 */
app.on("ready", () => {
  createWindow();
  createMenu();
  setupIpcHandlers();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle app termination - abort any running migrations
process.on("exit", () => {
  for (const [, ac] of activeMigrations) {
    ac.abort();
  }
  activeMigrations.clear();
});

process.on("SIGTERM", () => {
  for (const [, ac] of activeMigrations) {
    ac.abort();
  }
  activeMigrations.clear();
  app.quit();
});

process.on("SIGINT", () => {
  for (const [, ac] of activeMigrations) {
    ac.abort();
  }
  activeMigrations.clear();
  app.quit();
});

// Exported for testing
module.exports = {
  findGitRepos,
  resolveClonePath,
  setupIpcHandlers,
  getStore,
};
