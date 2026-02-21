const { contextBridge, ipcRenderer } = require('electron');

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
   * Check if the API backend is running
   */
  checkApiStatus: () => ipcRenderer.invoke('check-api-status'),

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
      ipcRenderer.on(channel, (event, ...args) => func(...args));
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
      ipcRenderer.removeListener(channel, func);
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
