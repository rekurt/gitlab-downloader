const {
  app,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} = require('electron');

const { createIpcHandlers, registerIpcHandlers } = require('./ipc-handlers');
const { createOperationRegistry } = require('./operation-registry');
const { createMainWindow, installApplicationMenu } = require('./window-security');

let mainWindow = null;
let registry = null;

async function bootstrap() {
  const [{ default: Store }, core] = await Promise.all([
    import('electron-store'),
    import('@gitlab-dump/core'),
  ]);
  const store = new Store({ name: 'settings' });
  registry = createOperationRegistry();
  mainWindow = createMainWindow({ baseDirectory: __dirname, isDev: !app.isPackaged });
  installApplicationMenu();

  const handlers = createIpcHandlers({
    store,
    safeStorage,
    registry,
    core,
    isTrustedSender: (event) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      return event.sender?.id === mainWindow.webContents.id;
    },
    selectDirectory: async () => {
      const selection = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
      });
      return selection.canceled ? null : selection.filePaths[0] || null;
    },
    selectRepository: async () => {
      const selection = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
      });
      return selection.canceled ? null : selection.filePaths[0] || null;
    },
    selectMapping: async () => {
      const selection = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'History mapping', extensions: ['json'] }],
      });
      return selection.canceled ? null : selection.filePaths[0] || null;
    },
    openExternal: (url) => shell.openExternal(url),
    openPath: (path) => shell.openPath(path),
    quit: () => app.quit(),
  });
  registerIpcHandlers(ipcMain, handlers);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error(`Unable to start GitLab Dump: ${error.message}`);
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow) bootstrap().catch(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => registry?.cancelAll());

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    registry?.cancelAll();
    app.quit();
  });
}

module.exports = { bootstrap };
