const { contextBridge, ipcRenderer } = require('electron');

// Map of original callbacks to their wrapped versions for proper removal
const listenerMap = new Map();

/**
 * Expose safe APIs to the renderer process.
 * This preload script establishes a secure bridge between the main and renderer processes.
 * All communication uses IPC directly to lib/ modules (no HTTP/Python backend).
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Get clone path (where repositories are stored)
   */
  getClonePath: () => ipcRenderer.invoke('get-clone-path'),

  /**
   * Get list of git repositories under clone path
   * @param {string} [clonePath] - Optional override for clone path
   * @returns {Promise<{repositories: Array}>}
   */
  getRepos: (clonePath) => ipcRenderer.invoke('get-repos', clonePath),

  /**
   * Get author/committer mappings from a config file
   * @param {string} [configPath] - Path to the config file
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  getAuthorMappings: (configPath) => ipcRenderer.invoke('get-author-mappings', configPath),

  /**
   * Save author/committer mappings to a config file
   * @param {object} params - { configPath, authorMappings, committerMappings }
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveAuthorMappings: (params) => ipcRenderer.invoke('save-author-mappings', params),

  /**
   * Get migration config from a repository path
   * @param {string} repoPath - Path to the repository
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  getConfig: (repoPath) => ipcRenderer.invoke('get-config', repoPath),

  /**
   * Save migration config to a repository
   * @param {object} params - { repoPath, config }
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveConfig: (params) => ipcRenderer.invoke('save-config', params),

  /**
   * Start a migration task
   * @param {object} config - Migration configuration
   * @returns {Promise<{success: boolean, migrationId?: string, error?: string}>}
   */
  startMigration: (config) => ipcRenderer.invoke('start-migration', config),

  /**
   * Cancel a running migration
   * @param {string} migrationId
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  cancelMigration: (migrationId) => ipcRenderer.invoke('cancel-migration', migrationId),

  /**
   * Request graceful shutdown
   */
  requestShutdown: () => ipcRenderer.invoke('request-shutdown'),

  /**
   * Load application settings from persistent store
   * @returns {Promise<object>}
   */
  loadSettings: () => ipcRenderer.invoke('load-settings'),

  /**
   * Save application settings to persistent store
   * @param {object} settings
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  /**
   * Test connection to GitLab instance
   * @param {object} settings - { gitlabUrl, token }
   * @returns {Promise<{success: boolean, username?: string, error?: string}>}
   */
  testConnection: (settings) => ipcRenderer.invoke('test-connection', settings),

  /**
   * Open directory picker dialog
   * @returns {Promise<string|null>}
   */
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  /**
   * Fetch projects from GitLab (group or user membership)
   * @param {object} [params] - { group?: string }
   * @returns {Promise<{success: boolean, projects?: Array, error?: string}>}
   */
  fetchProjects: (params) => ipcRenderer.invoke('fetch-projects', params),

  /**
   * Cancel active project fetch
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  cancelFetchProjects: () => ipcRenderer.invoke('cancel-fetch-projects'),

  /**
   * Start OAuth Device Flow authorization
   * @returns {Promise<{success: boolean, verificationUri?: string, userCode?: string, verificationUriComplete?: string, error?: string}>}
   */
  startOAuthDeviceFlow: () => ipcRenderer.invoke('start-oauth-device-flow'),

  /**
   * Listen for OAuth progress updates
   * @param {function} callback - Called with progress data {status, token?, message?}
   * @returns {function} - Cleanup function to remove listener
   */
  onOAuthProgress: (callback) => {
    const wrapper = (event, data) => callback(data);
    ipcRenderer.on('oauth-progress', wrapper);
    return () => {
      ipcRenderer.removeListener('oauth-progress', wrapper);
    };
  },

  /**
   * Listen for messages from the main process
   */
  on: (channel, func) => {
    const validChannels = [
      'migration-progress',
      'oauth-progress',
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
      'migration-progress',
      'oauth-progress',
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
      'migration-progress',
      'oauth-progress',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.once(channel, (event, ...args) => func(...args));
    }
  },

  /**
   * Convenience: listen for migration progress updates
   * @param {function} callback - Called with progress data
   * @returns {function} - Cleanup function to remove listener
   */
  onMigrationProgress: (callback) => {
    const wrapper = (event, data) => callback(data);
    ipcRenderer.on('migration-progress', wrapper);
    return () => {
      ipcRenderer.removeListener('migration-progress', wrapper);
    };
  },
});
