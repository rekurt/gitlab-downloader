const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');

let mainWindow;
let apiProcess = null;
const API_PORT = 5000;
const API_HOST = '127.0.0.1';

/**
 * Get the path to the Python API executable
 * In production, this will be embedded in the app bundle
 * In development, this should point to the Python backend
 */
function getPythonExecutablePath() {
  if (isDev) {
    // In development, use the Python from the virtual environment
    const platform = os.platform();
    if (platform === 'win32') {
      return path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
    } else {
      return path.join(__dirname, '..', 'venv', 'bin', 'python');
    }
  } else {
    // In production, the Python binary will be embedded
    const platform = os.platform();
    const resourcesPath = path.join(process.resourcesPath, 'python');
    if (platform === 'win32') {
      return path.join(resourcesPath, 'python.exe');
    } else if (platform === 'darwin') {
      // macOS app bundle
      return path.join(resourcesPath, 'python');
    } else {
      // Linux
      return path.join(resourcesPath, 'python');
    }
  }
}

/**
 * Start the Python API backend process
 */
async function startPythonBackend() {
  return new Promise((resolve, reject) => {
    try {
      const pythonPath = getPythonExecutablePath();

      // Check if Python executable exists
      if (!fs.existsSync(pythonPath)) {
        reject(new Error(`Python executable not found at ${pythonPath}`));
        return;
      }

      // Start the Python API server
      apiProcess = spawn(pythonPath, [
        '-m', 'gitlab_downloader.api',
        '--host', API_HOST,
        '--port', API_PORT.toString(),
      ]);

      // Log stdout and stderr
      apiProcess.stdout?.on('data', (data) => {
        console.log(`[Python Backend] ${data}`);
      });

      apiProcess.stderr?.on('data', (data) => {
        console.error(`[Python Backend Error] ${data}`);
      });

      apiProcess.on('error', (err) => {
        console.error('Failed to start Python backend:', err);
        reject(err);
      });

      apiProcess.on('exit', (code) => {
        console.log(`Python backend exited with code ${code}`);
      });

      // Give the process a moment to start, then resolve
      setTimeout(() => {
        resolve(true);
      }, 2000);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Stop the Python API backend process
 */
function stopPythonBackend() {
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:8080'
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Create the application menu
 */
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * IPC handlers for frontend communication
 */
function setupIpcHandlers() {
  // Get API endpoint
  ipcMain.handle('get-api-endpoint', () => {
    return `http://${API_HOST}:${API_PORT}`;
  });

  // Check API status
  ipcMain.handle('check-api-status', async () => {
    try {
      const response = await fetch(`http://${API_HOST}:${API_PORT}/api/status`);
      return response.ok;
    } catch {
      return false;
    }
  });
}

/**
 * App event handlers
 */
app.on('ready', async () => {
  try {
    // Start the Python backend
    await startPythonBackend();
    console.log(`Python backend started on ${API_HOST}:${API_PORT}`);

    // Create the window
    createWindow();
    createMenu();
    setupIpcHandlers();
  } catch (err) {
    console.error('Failed to start application:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On macOS, applications stay active until the user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create a window when the dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle app termination
process.on('exit', () => {
  stopPythonBackend();
});

// Handle SIGTERM (for graceful shutdown)
process.on('SIGTERM', () => {
  stopPythonBackend();
  app.quit();
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  stopPythonBackend();
  app.quit();
});
