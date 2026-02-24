const { app, BrowserWindow, Menu, ipcMain } = require("electron");
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
        const lib = await getCoreLib();
        await lib.saveMappings(
          configPath,
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
            progress: 50,
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
            status: "running",
            progress: 50,
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
};
