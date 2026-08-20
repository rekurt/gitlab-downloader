const { BrowserWindow, Menu, app } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function createMainWindow(options = {}) {
  const baseDirectory = options.baseDirectory || __dirname;
  const isDev = Boolean(options.isDev);
  const startUrl = isDev
    ? 'http://localhost:8000'
    : pathToFileURL(path.join(baseDirectory, 'dist', 'index.html')).toString();
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(baseDirectory, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== startUrl) event.preventDefault();
  });
  window.loadURL(startUrl);
  return window;
}

function installApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [{ label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { role: 'copy' }, { role: 'paste' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { createMainWindow, installApplicationMenu };
