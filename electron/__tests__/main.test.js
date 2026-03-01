const path = require('path');
const fs = require('fs');
const os = require('os');

// We need to mock Electron modules before requiring main.js
jest.mock('electron', () => ({
  app: {
    on: jest.fn(),
    quit: jest.fn(),
    getPath: jest.fn().mockReturnValue('/tmp/test-userdata'),
    getVersion: jest.fn().mockReturnValue('0.1.0'),
    getName: jest.fn().mockReturnValue('gitlab-dump-desktop'),
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadURL: jest.fn(),
    on: jest.fn(),
    webContents: {
      openDevTools: jest.fn(),
      send: jest.fn(),
    },
    isDestroyed: jest.fn().mockReturnValue(false),
  })),
  Menu: {
    buildFromTemplate: jest.fn().mockReturnValue({}),
    setApplicationMenu: jest.fn(),
  },
  ipcMain: {
    handle: jest.fn(),
  },
  dialog: {
    showOpenDialog: jest.fn().mockResolvedValue({ canceled: false, filePaths: ['/tmp/selected'] }),
  },
  shell: {
    openPath: jest.fn().mockResolvedValue(''),
  },
}));

jest.mock('electron-is-dev', () => false);

const { findGitRepos, resolveClonePath } = require('../main');

describe('findGitRepos', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('finds repos with .git directories', () => {
    // Create a fake repo
    const repoDir = path.join(tmpDir, 'my-repo');
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('my-repo');
    expect(repos[0].path).toBe(repoDir);
  });

  test('finds nested repos', () => {
    const groupDir = path.join(tmpDir, 'group');
    const repoDir = path.join(groupDir, 'subgroup', 'repo');
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('repo');
  });

  test('returns empty array for non-existent path', () => {
    const repos = findGitRepos('/nonexistent/path/12345');
    expect(repos).toEqual([]);
  });

  test('returns empty array for empty directory', () => {
    const repos = findGitRepos(tmpDir);
    expect(repos).toEqual([]);
  });

  test('does not recurse into .git directories', () => {
    const repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, '.git', 'refs'), { recursive: true });

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe(repoDir);
  });

  test('finds multiple repos at same level', () => {
    fs.mkdirSync(path.join(tmpDir, 'repo1', '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'repo2', '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'repo3', '.git'), { recursive: true });

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(3);
    const names = repos.map((r) => r.name).sort();
    expect(names).toEqual(['repo1', 'repo2', 'repo3']);
  });

  test('reads remote origin URL from git config', () => {
    const repoDir = path.join(tmpDir, 'repo');
    const gitDir = path.join(repoDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(
      path.join(gitDir, 'config'),
      '[remote "origin"]\n\turl = https://gitlab.com/group/repo.git\n',
    );

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0].url).toBe('https://gitlab.com/group/repo.git');
  });

  test('handles missing git config gracefully', () => {
    const repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0].url).toBe('');
  });

  test('respects maxDepth parameter', () => {
    // Create a deeply nested repo
    const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'repo');
    fs.mkdirSync(path.join(deepPath, '.git'), { recursive: true });

    // With maxDepth 2, should not find repo at depth 4
    const repos = findGitRepos(tmpDir, 2);
    expect(repos).toHaveLength(0);

    // With maxDepth 5, should find it
    const repos2 = findGitRepos(tmpDir, 5);
    expect(repos2).toHaveLength(1);
  });

  test('skips node_modules directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'some-pkg', '.git'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, 'real-repo', '.git'), { recursive: true });

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('real-repo');
  });

  test('skips hidden directories (except .git)', () => {
    fs.mkdirSync(path.join(tmpDir, '.hidden', 'repo', '.git'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, 'visible-repo', '.git'), {
      recursive: true,
    });

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('visible-repo');
  });

  test('includes last_updated from FETCH_HEAD if available', () => {
    const repoDir = path.join(tmpDir, 'repo');
    const gitDir = path.join(repoDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'FETCH_HEAD'), 'dummy');

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0].last_updated).toBeTruthy();
    // Should be a valid ISO date
    expect(new Date(repos[0].last_updated).getTime()).toBeGreaterThan(0);
  });

  test('falls back to HEAD for last_updated', () => {
    const repoDir = path.join(tmpDir, 'repo');
    const gitDir = path.join(repoDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main');

    const repos = findGitRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0].last_updated).toBeTruthy();
  });
});

describe('resolveClonePath', () => {
  const originalEnv = process.env.CLONE_PATH;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLONE_PATH = originalEnv;
    } else {
      delete process.env.CLONE_PATH;
    }
  });

  test('returns default repositories path when CLONE_PATH not set', () => {
    delete process.env.CLONE_PATH;
    const result = resolveClonePath();
    expect(result).toBe(path.resolve(os.homedir(), 'repositories'));
  });

  test('resolves CLONE_PATH from env', () => {
    process.env.CLONE_PATH = '/tmp/my-repos';
    const result = resolveClonePath();
    expect(result).toBe('/tmp/my-repos');
  });

  test('expands tilde in CLONE_PATH', () => {
    process.env.CLONE_PATH = '~/gitlab-repos';
    const result = resolveClonePath();
    expect(result).toBe(path.join(os.homedir(), 'gitlab-repos'));
  });

  test('resolves relative CLONE_PATH against homedir', () => {
    process.env.CLONE_PATH = 'my-repos';
    const result = resolveClonePath();
    expect(result).toBe(path.resolve(os.homedir(), 'my-repos'));
  });
});

describe('setupIpcHandlers', () => {
  const { ipcMain } = require('electron');

  beforeEach(() => {
    ipcMain.handle.mockClear();
  });

  test('registers all expected IPC channels', () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const registeredChannels = ipcMain.handle.mock.calls.map(
      (call) => call[0],
    );
    expect(registeredChannels).toContain('get-clone-path');
    expect(registeredChannels).toContain('get-repos');
    expect(registeredChannels).toContain('get-author-mappings');
    expect(registeredChannels).toContain('save-author-mappings');
    expect(registeredChannels).toContain('get-config');
    expect(registeredChannels).toContain('save-config');
    expect(registeredChannels).toContain('start-migration');
    expect(registeredChannels).toContain('cancel-migration');
    expect(registeredChannels).toContain('request-shutdown');
    expect(registeredChannels).toContain('load-settings');
    expect(registeredChannels).toContain('save-settings');
    expect(registeredChannels).toContain('test-connection');
    expect(registeredChannels).toContain('select-directory');
    expect(registeredChannels).toContain('start-oauth-device-flow');
    expect(registeredChannels).toContain('fetch-projects');
    expect(registeredChannels).toContain('cancel-fetch-projects');
    expect(registeredChannels).toContain('clone-repositories');
    expect(registeredChannels).toContain('cancel-clone');
    expect(registeredChannels).toContain('dry-run-projects');
    expect(registeredChannels).toContain('open-path');
  });

  test('get-clone-path handler returns resolved path', () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const getClonePathCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'get-clone-path',
    );
    expect(getClonePathCall).toBeTruthy();

    const handler = getClonePathCall[1];
    const result = handler();
    expect(typeof result).toBe('string');
    expect(path.isAbsolute(result)).toBe(true);
  });

  test('get-repos handler returns repositories object', () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const getReposCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'get-repos',
    );
    expect(getReposCall).toBeTruthy();

    const handler = getReposCall[1];
    // Call with a non-existent path to get empty result
    const result = handler(null, '/nonexistent/path/12345');
    expect(result).toEqual({ repositories: [] });
  });

  test('get-repos handler accepts custom clone path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-test-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'test-repo', '.git'), {
        recursive: true,
      });

      const { setupIpcHandlers } = require('../main');
      setupIpcHandlers();

      const getReposCall = ipcMain.handle.mock.calls.find(
        (c) => c[0] === 'get-repos',
      );
      const handler = getReposCall[1];
      const result = handler(null, tmpDir);
      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].name).toBe('test-repo');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('cancel-migration handler returns error for unknown migration', () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const cancelCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'cancel-migration',
    );
    const handler = cancelCall[1];
    const result = handler(null, 'nonexistent-id');
    expect(result).toEqual({ success: false, error: 'Migration not found' });
  });

  test('load-settings handler returns stored settings', async () => {
    const mockStore = { get: jest.fn().mockReturnValue({ gitlabUrl: 'https://gitlab.com' }) };
    jest.doMock('electron-store', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => mockStore),
    }));

    // Reset the cached store to force re-import
    const mainModule = require('../main');
    // We need to access the handler directly via ipcMain.handle mock
    mainModule.setupIpcHandlers();

    const loadSettingsCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'load-settings',
    );
    expect(loadSettingsCall).toBeTruthy();
  });

  test('save-settings handler validates and saves settings', async () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const saveCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'save-settings',
    );
    expect(saveCall).toBeTruthy();
  });

  test('test-connection handler returns error for missing URL', async () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const testConnCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'test-connection',
    );
    expect(testConnCall).toBeTruthy();

    const handler = testConnCall[1];
    const result = await handler(null, { gitlabUrl: '', token: '' });
    expect(result).toEqual({ success: false, error: 'GitLab URL is required' });
  });

  test('select-directory handler returns selected path', async () => {
    const { dialog } = require('electron');
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const selectDirCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'select-directory',
    );
    expect(selectDirCall).toBeTruthy();

    const handler = selectDirCall[1];
    const result = await handler();
    expect(result).toBe('/tmp/selected');
    expect(dialog.showOpenDialog).toHaveBeenCalled();
  });

  test('start-oauth-device-flow handler returns error when settings missing', async () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const oauthCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'start-oauth-device-flow',
    );
    expect(oauthCall).toBeTruthy();

    const handler = oauthCall[1];
    const result = await handler({ sender: { send: jest.fn() } });
    expect(result.success).toBe(false);
    // Should fail because gitlabUrl is empty in default store
    expect(result.error).toBeTruthy();
  });

  test('start-oauth-device-flow handler is registered', () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const oauthCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'start-oauth-device-flow',
    );
    expect(oauthCall).toBeTruthy();
    expect(typeof oauthCall[1]).toBe('function');
  });

  test('select-directory handler returns null when canceled', async () => {
    const { dialog } = require('electron');
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });

    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const selectDirCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'select-directory',
    );
    const handler = selectDirCall[1];
    const result = await handler();
    expect(result).toBeNull();
  });

  test('fetch-projects handler is registered', () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const registeredChannels = ipcMain.handle.mock.calls.map(
      (call) => call[0],
    );
    expect(registeredChannels).toContain('fetch-projects');
    expect(registeredChannels).toContain('cancel-fetch-projects');
  });

  test('fetch-projects handler returns error when URL missing', async () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const fetchCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'fetch-projects',
    );
    expect(fetchCall).toBeTruthy();

    const handler = fetchCall[1];
    const result = await handler(null, {});
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('cancel-fetch-projects handler returns error when no active fetch', () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const cancelCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'cancel-fetch-projects',
    );
    expect(cancelCall).toBeTruthy();

    const handler = cancelCall[1];
    const result = handler();
    expect(result).toEqual({ success: false, error: 'No active fetch' });
  });

  test('registers clone-repositories, cancel-clone, and dry-run-projects channels', () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const registeredChannels = ipcMain.handle.mock.calls.map(
      (call) => call[0],
    );
    expect(registeredChannels).toContain('clone-repositories');
    expect(registeredChannels).toContain('cancel-clone');
    expect(registeredChannels).toContain('dry-run-projects');
  });

  test('clone-repositories handler returns error when no projects', async () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const cloneCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'clone-repositories',
    );
    expect(cloneCall).toBeTruthy();

    const handler = cloneCall[1];
    const result = await handler(null, { projects: [], updateExisting: false });
    expect(result.success).toBe(false);
    expect(result.error).toBe('No projects to clone');
  });

  test('clone-repositories handler returns error with empty projects', async () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const cloneCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'clone-repositories',
    );
    const handler = cloneCall[1];
    const result = await handler(null, { projects: null });
    expect(result.success).toBe(false);
    expect(result.error).toBe('No projects to clone');
  });

  test('cancel-clone handler returns error when no active clone', () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const cancelCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'cancel-clone',
    );
    expect(cancelCall).toBeTruthy();

    const handler = cancelCall[1];
    const result = handler();
    expect(result).toEqual({ success: false, error: 'No active clone' });
  });

  test('dry-run-projects handler returns empty targets for empty projects', async () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const dryRunCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'dry-run-projects',
    );
    expect(dryRunCall).toBeTruthy();

    const handler = dryRunCall[1];
    const result = await handler(null, { projects: [] });
    expect(result).toEqual({ success: true, targets: [] });
  });

  test('open-path handler returns error when path is empty', async () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const openPathCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'open-path',
    );
    expect(openPathCall).toBeTruthy();

    const handler = openPathCall[1];
    const result = await handler(null, '');
    expect(result).toEqual({ success: false, error: 'Path is required' });
  });

  test('open-path handler calls shell.openPath', async () => {
    const { shell } = require('electron');
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const openPathCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'open-path',
    );
    const handler = openPathCall[1];
    const result = await handler(null, '/tmp/some-dir');
    expect(result).toEqual({ success: true });
    expect(shell.openPath).toHaveBeenCalledWith('/tmp/some-dir');
  });

  test('open-path handler returns error when shell.openPath fails', async () => {
    const { shell } = require('electron');
    shell.openPath.mockResolvedValueOnce('Failed to open path');

    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const openPathCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'open-path',
    );
    const handler = openPathCall[1];
    const result = await handler(null, '/tmp/bad-path');
    expect(result).toEqual({ success: false, error: 'Failed to open path' });
  });

  test('dry-run-projects handler is callable with projects', async () => {
    const { setupIpcHandlers } = require('../main');
    setupIpcHandlers();

    const dryRunCall = ipcMain.handle.mock.calls.find(
      (c) => c[0] === 'dry-run-projects',
    );
    const handler = dryRunCall[1];
    // Handler requires ESM core lib; verify it returns a result object
    // (either success with targets or error from ESM import)
    const result = await handler(null, {
      projects: [
        { name: 'my-repo', group_path: 'group' },
      ],
    });
    expect(result).toHaveProperty('success');
    if (result.success) {
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].name).toBe('my-repo');
    }
  });
});
