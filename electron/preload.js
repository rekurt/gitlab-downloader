const { contextBridge, ipcRenderer } = require('electron');

// Map of original callbacks to their wrapped versions for proper removal
const listenerMap = new Map();

/**
 * Expose safe APIs to the renderer process
 * This preload script establishes a secure bridge between the main and renderer processes
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Get the API endpoint URL
   */
  getApiEndpoint: () => ipcRenderer.invoke('get-api-endpoint'),

  /**
   * Get the API token for authenticating mutating requests
   */
  getApiToken: () => ipcRenderer.invoke('get-api-token'),

  /**
   * Check if the API backend is running
   */
  checkApiStatus: () => ipcRenderer.invoke('check-api-status'),

  /**
   * Request graceful shutdown
   */
  requestShutdown: () => ipcRenderer.invoke('request-shutdown'),

  /**
   * Get clone path (where repositories are stored)
   */
  getClonePath: () => ipcRenderer.invoke('get-clone-path'),

  /**
   * Get backend process status
   */
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),

  /**
   * Send a message to the main process
   */
  send: (channel, args) => {
    // Whitelist allowed channels
    const validChannels = ['app-quit', 'app-minimize', 'app-maximize'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, args);
    }
  },

  /**
   * Listen for messages from the main process
   */
  on: (channel, func) => {
    // Whitelist allowed channels
    const validChannels = [
      'backend-status',
      'backend-error',
      'migration-progress',
      'migration-complete',
    ];
    if (validChannels.includes(channel)) {
      const wrapper = (event, ...args) => func(...args);
      listenerMap.set(func, wrapper);
      ipcRenderer.on(channel, wrapper);
    }
  },

  /**
   * Remove event listener
   */
  off: (channel, func) => {
    const validChannels = [
      'backend-status',
      'backend-error',
      'migration-progress',
      'migration-complete',
    ];
    if (validChannels.includes(channel)) {
      const wrapper = listenerMap.get(func);
      if (wrapper) {
        ipcRenderer.removeListener(channel, wrapper);
        listenerMap.delete(func);
      }
    }
  },

  /**
   * One-time listener
   */
  once: (channel, func) => {
    const validChannels = [
      'backend-status',
      'backend-error',
      'migration-progress',
      'migration-complete',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.once(channel, (event, ...args) => func(...args));
    }
  },
});
