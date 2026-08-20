const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel) {
  return (payload) => ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('electronAPI', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: invoke('settings:save'),
  testConnection: invoke('connection:test'),
  selectDirectory: () => ipcRenderer.invoke('directory:select'),
  listRepositories: invoke('repositories:list'),
  openRepository: invoke('repository:open'),
  startOAuth: invoke('oauth:start'),
  openOAuth: invoke('oauth:open'),
  fetchProjects: invoke('projects:fetch'),
  startClone: invoke('clone:start'),
  planTransfer: invoke('transfer:plan'),
  startTransfer: invoke('transfer:start'),
  selectRewriteRepository: () => ipcRenderer.invoke('rewrite:select-repository'),
  selectRewriteMapping: () => ipcRenderer.invoke('rewrite:select-mapping'),
  previewRewrite: invoke('rewrite:preview'),
  startRewrite: invoke('rewrite:start'),
  getOperationStatus: invoke('operation:status'),
  cancelOperation: invoke('operation:cancel'),
  requestShutdown: () => ipcRenderer.invoke('app:shutdown'),
  onOperationEvent(callback) {
    if (typeof callback !== 'function') throw new TypeError('Callback is required');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('operation:event', listener);
    return () => ipcRenderer.removeListener('operation:event', listener);
  },
});
