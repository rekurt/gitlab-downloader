const { EventEmitter } = require('node:events');
const { mkdtemp, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

jest.mock('electron', () => ({
  app: {
    on: jest.fn(),
    quit: jest.fn(),
    getPath: jest.fn().mockReturnValue('/tmp/gitlab-dump-test'),
    isPackaged: true,
  },
  BrowserWindow: jest.fn(),
  Menu: {
    buildFromTemplate: jest.fn().mockReturnValue({}),
    setApplicationMenu: jest.fn(),
  },
  ipcMain: { handle: jest.fn(), removeHandler: jest.fn() },
  dialog: { showOpenDialog: jest.fn() },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  safeStorage: {
    isEncryptionAvailable: jest.fn().mockReturnValue(true),
    encryptString: jest.fn((value) => Buffer.from(`encrypted:${value}`)),
    decryptString: jest.fn((value) => value.toString().replace(/^encrypted:/, '')),
  },
}));

const { BrowserWindow, Menu, app, safeStorage } = require('electron');
const { createOperationRegistry } = require('../operation-registry');
const { createMainWindow, installApplicationMenu } = require('../window-security');
const { createIpcHandlers, registerIpcHandlers, safeOAuthUrl } = require('../ipc-handlers');

function memoryStore() {
  const values = new Map();
  return {
    get: jest.fn((key, fallback) => values.has(key) ? values.get(key) : fallback),
    set: jest.fn((key, value) => values.set(key, value)),
    values,
  };
}

describe('operation registry', () => {
  test('uses an independent AbortController for every operation', () => {
    const registry = createOperationRegistry({ id: (() => {
      let value = 0;
      return () => `op-${++value}`;
    })() });
    const first = registry.begin('clone', 10);
    const second = registry.begin('oauth', 10);
    registry.cancel(first.id, 10);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(registry.status(first.id, 10)).toMatchObject({ status: 'canceled' });
  });

  test('does not expose one renderer operation to another sender', () => {
    const registry = createOperationRegistry({ id: () => 'op-private' });
    registry.begin('transfer', 10);
    expect(() => registry.status('op-private', 11)).toThrow('not available');
  });

  test('records partial, successful, failed, and shutdown states', () => {
    let value = 0;
    const registry = createOperationRegistry({ id: () => `state-${++value}` });
    const partial = registry.begin('transfer', 1);
    registry.complete(partial.id, { status: 'partial', failures: [] });
    expect(registry.status(partial.id, 1)).toMatchObject({ status: 'partial' });

    const finished = registry.begin('clone', 1);
    registry.complete(finished.id, { status: 'finished' });
    registry.complete(finished.id, { status: 'partial' });
    expect(registry.status(finished.id, 1)).toMatchObject({ status: 'finished' });

    const failed = registry.begin('rewrite', 1);
    registry.fail(failed.id, new Error('rewrite failed'));
    registry.fail(failed.id, new Error('ignored'));
    expect(registry.status(failed.id, 1)).toMatchObject({ status: 'failed', error: 'rewrite failed' });

    const reportedFailure = registry.begin('rewrite', 1);
    registry.complete(reportedFailure.id, { status: 'failed', backupPath: '/safe/before.bundle' });
    expect(registry.status(reportedFailure.id, 1)).toMatchObject({
      status: 'failed', result: { status: 'failed', backupPath: '/safe/before.bundle' },
    });

    const running = registry.begin('oauth', 1);
    registry.cancelAll();
    expect(running.signal.aborted).toBe(true);
    expect(registry.status(running.id, 1)).toMatchObject({ status: 'canceled' });
  });

  test('rejects duplicate operation IDs and marks an aborted failure as canceled', () => {
    const registry = createOperationRegistry({ id: () => 'duplicate' });
    const operation = registry.begin('clone', 1);
    expect(() => registry.begin('clone', 1)).toThrow('already exists');
    operation.controller.abort();
    registry.fail(operation.id, 'aborted');
    expect(registry.status(operation.id, 1).status).toBe('canceled');
  });
});

describe('window security', () => {
  test('enables sandbox and blocks renderer navigation and window creation', () => {
    const webContents = new EventEmitter();
    webContents.setWindowOpenHandler = jest.fn();
    const window = {
      webContents,
      loadURL: jest.fn(),
      on: jest.fn(),
    };
    BrowserWindow.mockImplementationOnce((options) => {
      window.options = options;
      return window;
    });
    createMainWindow({ baseDirectory: '/app/electron', isDev: false });

    expect(window.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    expect(webContents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    const navigation = { preventDefault: jest.fn() };
    webContents.emit('will-navigate', navigation, 'https://evil.example.com');
    expect(navigation.preventDefault).toHaveBeenCalled();
  });

  test('loads the development URL and allows only the exact current navigation', () => {
    const webContents = new EventEmitter();
    webContents.setWindowOpenHandler = jest.fn();
    const window = { webContents, loadURL: jest.fn() };
    BrowserWindow.mockImplementationOnce(() => window);
    createMainWindow({ baseDirectory: '/app/electron', isDev: true });
    expect(window.loadURL).toHaveBeenCalledWith('http://localhost:8000');
    const same = { preventDefault: jest.fn() };
    webContents.emit('will-navigate', same, 'http://localhost:8000');
    expect(same.preventDefault).not.toHaveBeenCalled();
  });

  test('installs an application menu whose exit item quits', () => {
    installApplicationMenu();
    const template = Menu.buildFromTemplate.mock.calls.at(-1)[0];
    template[0].submenu[0].click();
    expect(app.quit).toHaveBeenCalled();
    expect(Menu.setApplicationMenu).toHaveBeenCalled();
  });
});

describe('IPC security and OAuth', () => {
  function fixture(overrides = {}) {
    const store = memoryStore();
    let operationNumber = 0;
    const registry = createOperationRegistry({ id: () => `op-${++operationNumber}` });
    const sent = [];
    const sender = { id: 7, send: (...args) => sent.push(args), isDestroyed: () => false };
    const event = { sender };
    const core = {
      validateGitlabUrl: () => true,
      deviceAuthorize: jest.fn().mockResolvedValue({
        device_code: 'device-1',
        verification_uri: 'https://gitlab.example.com/oauth/device',
        verification_uri_complete: 'https://gitlab.example.com/oauth/device?code=abc',
        user_code: 'ABCD',
        interval: 1,
        expires_in: 60,
      }),
      pollDeviceToken: jest.fn().mockResolvedValue({ access_token: 'oauth-secret' }),
      getCurrentUser: jest.fn().mockResolvedValue({ username: 'alice', name: 'Alice' }),
      findGitRepositories: jest.fn().mockReturnValue([]),
      getUserProjects: jest.fn().mockResolvedValue([]),
      getAllProjects: jest.fn().mockResolvedValue([]),
      fetchGroupMetadata: jest.fn().mockResolvedValue({ full_path: 'team' }),
      cloneAllRepositories: jest.fn().mockResolvedValue([]),
      planTransfer: jest.fn().mockResolvedValue({ warnings: [], entities: [] }),
      executeTransfer: jest.fn().mockResolvedValue({ status: 'finished', entities: [] }),
      validateHistoryMapping: jest.fn((mapping) => mapping),
      previewHistoryRewrite: jest.fn().mockResolvedValue({ status: 'preview', changedCommits: 1, changedRefs: [] }),
      rewriteHistory: jest.fn().mockResolvedValue({ status: 'finished', changedCommits: 1, changedRefs: [] }),
      ...overrides.core,
    };
    const openExternal = overrides.openExternal || jest.fn();
    const openPath = overrides.openPath || jest.fn().mockResolvedValue('');
    const quit = overrides.quit || jest.fn();
    const handlers = createIpcHandlers({
      store,
      safeStorage,
      registry,
      core,
      isTrustedSender: (candidate) => candidate.sender.id === 7,
      selectDirectory: overrides.selectDirectory,
      selectRepository: overrides.selectRepository,
      selectMapping: overrides.selectMapping,
      openExternal,
      openPath,
      quit,
      now: overrides.now,
    });
    return { handlers, store, registry, core, event, sent, openExternal, openPath, quit };
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  test('encrypts PATs and never returns them to the renderer', async () => {
    const { handlers, store, event } = fixture();
    await handlers['settings:save'](event, {
      gitlabUrl: 'https://gitlab.example.com',
      sourceToken: 'source-plaintext',
    });
    const loaded = await handlers['settings:load'](event);
    expect(loaded).toMatchObject({
      gitlabUrl: 'https://gitlab.example.com',
      hasSourceToken: true,
    });
    expect(JSON.stringify(loaded)).not.toContain('source-plaintext');
    expect(JSON.stringify([...store.values])).not.toContain('source-plaintext');
    expect(store.get('secrets.sourceToken')).toBe(
      Buffer.from('encrypted:source-plaintext').toString('base64'),
    );
  });

  test('migrates legacy plaintext settings secrets before returning settings', async () => {
    const legacy = fixture();
    legacy.store.set('settings', {
      gitlabUrl: 'https://gitlab.example.com',
      token: 'legacy-plaintext-token',
      oauthToken: 'legacy-oauth-token',
      obsoleteField: 'discard-me',
    });

    const loaded = await legacy.handlers['settings:load'](legacy.event);

    expect(loaded).toMatchObject({
      gitlabUrl: 'https://gitlab.example.com',
      hasToken: true,
      hasOAuthToken: true,
    });
    expect(JSON.stringify(loaded)).not.toContain('legacy-plaintext-token');
    expect(legacy.store.get('settings')).toEqual({
      gitlabUrl: 'https://gitlab.example.com',
    });
    expect(JSON.stringify([...legacy.store.values])).not.toContain('legacy-plaintext-token');
    expect(JSON.stringify([...legacy.store.values])).not.toContain('legacy-oauth-token');
  });

  test('persists only allowlisted public settings and validates them before secrets', async () => {
    const { handlers, store, event } = fixture({
      core: { validateGitlabUrl: (url) => url === 'https://gitlab.example.com' },
    });
    await expect(handlers['settings:save'](event, {
      gitlabUrl: 'https://invalid.example.com',
      sourceToken: 'must-not-be-saved',
    })).resolves.toMatchObject({ success: false });
    expect(store.get('secrets.sourceToken', null)).toBeNull();

    await handlers['settings:save'](event, {
      gitlabUrl: 'https://gitlab.example.com',
      group: 'team',
      maxConcurrency: 4,
      unexpectedSecret: 'must-not-be-persisted',
    });
    expect(store.get('settings')).toEqual({
      gitlabUrl: 'https://gitlab.example.com',
      group: 'team',
      maxConcurrency: 4,
    });
    expect(JSON.stringify([...store.values])).not.toContain('must-not-be-persisted');
  });

  test('uses current unsaved OAuth form values and emits profile without access token', async () => {
    const { handlers, core, event, sent } = fixture();
    const started = await handlers['oauth:start'](event, {
      gitlabUrl: 'https://gitlab.example.com',
      oauthClientId: 'current-form-client',
      oauthScope: 'api',
    });
    expect(started).toMatchObject({ success: true, operationId: 'op-1', userCode: 'ABCD' });
    expect(core.deviceAuthorize.mock.calls[0][0]).toMatchObject({
      url: 'https://gitlab.example.com',
      oauthClientId: 'current-form-client',
      oauthScope: 'api',
    });
    await new Promise((resolve) => setImmediate(resolve));
    const serialized = JSON.stringify(sent);
    expect(serialized).toContain('alice');
    expect(serialized).not.toContain('oauth-secret');
  });

  test('does not persist an OAuth token when cancellation wins the profile race', async () => {
    let releaseProfile;
    const profileGate = new Promise((resolve) => { releaseProfile = resolve; });
    const oauth = fixture({
      core: {
        getCurrentUser: jest.fn(async () => {
          await profileGate;
          return { username: 'late-user', name: 'Late User' };
        }),
      },
    });
    const started = await oauth.handlers['oauth:start'](oauth.event, {
      gitlabUrl: 'https://gitlab.example.com',
      oauthClientId: 'client',
    });
    await flush();
    await oauth.handlers['operation:cancel'](oauth.event, { operationId: started.operationId });
    releaseProfile();
    await flush();

    await expect(oauth.handlers['settings:load'](oauth.event)).resolves.toMatchObject({
      hasOAuthToken: false,
    });
    expect(JSON.stringify([...oauth.store.values])).not.toContain('oauth-secret');
    expect(oauth.sent.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: started.operationId, status: 'canceled' }),
    ]));
  });

  test('rejects OAuth instance URLs containing embedded credentials', async () => {
    const { handlers, event } = fixture();
    await expect(handlers['oauth:start'](event, {
      gitlabUrl: 'https://oauth2:must-not-leak@gitlab.example.com',
      oauthClientId: 'client',
    })).rejects.toThrow(/credentials/i);
  });

  test('rejects untrusted senders before invoking a handler', async () => {
    const { handlers } = fixture();
    await expect(handlers['settings:load']({ sender: { id: 99 } })).rejects.toThrow(
      'Untrusted renderer',
    );
  });

  test('accepts only directory IDs issued by the main process', async () => {
    const { handlers, event } = fixture({
      selectDirectory: jest.fn().mockResolvedValue('/allowed/repositories'),
    });
    const selected = await handlers['directory:select'](event);
    await expect(handlers['repositories:list'](event, {
      directoryId: selected.directoryId,
    })).resolves.toEqual({ success: true, repositories: [] });
    await expect(handlers['repositories:list'](event, {
      directoryId: '/arbitrary/path',
    })).rejects.toThrow('Unknown directory');
  });

  test('validates public settings and connection prerequisites/results', async () => {
    const { handlers, core, event } = fixture({
      core: { validateGitlabUrl: (url) => url.startsWith('https://') },
    });
    await expect(handlers['settings:save'](event, { gitlabUrl: 'http://unsafe.example.com' }))
      .resolves.toMatchObject({ success: false });
    await expect(handlers['connection:test'](event, { gitlabUrl: 'https://gitlab.example.com/' }))
      .resolves.toMatchObject({ success: false });
    await handlers['settings:save'](event, {
      gitlabUrl: 'https://gitlab.example.com', token: 'shared-secret',
    });
    await expect(handlers['connection:test'](event, { gitlabUrl: 'https://gitlab.example.com/' }))
      .resolves.toEqual({ success: true, profile: { username: 'alice', name: 'Alice' } });
    expect(core.getCurrentUser).toHaveBeenCalledWith({
      url: 'https://gitlab.example.com', token: 'shared-secret',
    });
  });

  test('keeps secrets in memory when OS encryption is unavailable', async () => {
    safeStorage.isEncryptionAvailable.mockReturnValueOnce(false).mockReturnValueOnce(false);
    const { handlers, store, event } = fixture();
    await handlers['settings:save'](event, { sourceToken: 'memory-only' });
    const loaded = await handlers['settings:load'](event);
    expect(loaded.hasSourceToken).toBe(true);
    expect(store.set).toHaveBeenCalledWith('settings', {});
    expect(JSON.stringify([...store.values])).not.toContain('memory-only');
  });

  test('handles canceled directory selection and repository open results', async () => {
    const canceled = fixture({ selectDirectory: jest.fn().mockResolvedValue(null) });
    await expect(canceled.handlers['directory:select'](canceled.event))
      .resolves.toEqual({ success: false, canceled: true });

    const openPath = jest.fn().mockResolvedValueOnce('No application').mockResolvedValueOnce('');
    const found = fixture({
      selectDirectory: jest.fn().mockResolvedValue('/allowed'),
      openPath,
      core: {
        findGitRepositories: () => [{
          name: 'app', path: '/allowed/app', url: 'https://gitlab.example.com/team/app.git', last_updated: 'today',
        }],
      },
    });
    const directory = await found.handlers['directory:select'](found.event);
    const listed = await found.handlers['repositories:list'](found.event, directory);
    expect(listed.repositories[0]).not.toHaveProperty('path');
    await expect(found.handlers['repository:open'](found.event, listed.repositories[0]))
      .resolves.toMatchObject({ success: false });
    await expect(found.handlers['repository:open'](found.event, listed.repositories[0]))
      .resolves.toEqual({ success: true });
  });

  test('validates OAuth HTTPS/origin, opens the issued URL, and reports polling errors', async () => {
    const openExternal = jest.fn();
    const ok = fixture({ openExternal });
    const started = await ok.handlers['oauth:start'](ok.event, {
      gitlabUrl: 'https://gitlab.example.com/', oauthClientId: 'client', oauthScope: 'api',
    });
    await ok.handlers['oauth:open'](ok.event, { operationId: started.operationId });
    expect(openExternal).toHaveBeenCalledWith('https://gitlab.example.com/oauth/device?code=abc');
    await expect(ok.handlers['oauth:open'](ok.event, { operationId: 'missing' })).rejects.toThrow();

    await expect(ok.handlers['oauth:start'](ok.event, {
      gitlabUrl: 'http://gitlab.example.com', oauthClientId: 'client',
    })).rejects.toThrow('HTTPS');
    await expect(ok.handlers['oauth:start'](ok.event, {
      gitlabUrl: 'https://gitlab.example.com', oauthClientId: '',
    })).resolves.toMatchObject({ success: false });

    const badOrigin = fixture({
      core: { deviceAuthorize: jest.fn().mockResolvedValue({
        device_code: 'device', verification_uri: 'https://evil.example.com/oauth',
      }) },
    });
    await expect(badOrigin.handlers['oauth:start'](badOrigin.event, {
      gitlabUrl: 'https://gitlab.example.com', oauthClientId: 'client',
    })).rejects.toThrow('unexpected origin');

    const pollFailure = fixture({
      core: { pollDeviceToken: jest.fn().mockRejectedValue(new Error('authorization denied')) },
    });
    const failed = await pollFailure.handlers['oauth:start'](pollFailure.event, {
      gitlabUrl: 'https://gitlab.example.com', oauthClientId: 'client',
    });
    await flush();
    expect(pollFailure.registry.status(failed.operationId, 7)).toMatchObject({ status: 'failed' });
    expect(pollFailure.sent.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'failed', message: 'authorization denied' }),
    ]));
  });

  test('fetches project sessions by user/group and starts clone with partial/failed outcomes', async () => {
    const group = fixture({
      selectDirectory: jest.fn().mockResolvedValue('/allowed'),
      core: {
        getAllProjects: jest.fn().mockResolvedValue([
          { id: 1, name: 'App', path_with_namespace: 'team/app' },
          { id: 2, name: 'Other', path_with_namespace: 'team/other' },
        ]),
        cloneAllRepositories: jest.fn().mockImplementation(async (projects, _config, options) => {
          options.onResult({ id: 1, status: 'finished' });
          expect(projects.map((project) => project.id)).toEqual([1]);
          return [{ id: 1, status: 'failed' }];
        }),
      },
    });
    await group.handlers['settings:save'](group.event, {
      gitlabUrl: 'https://gitlab.example.com', sourceToken: 'source-token', maxConcurrency: 2,
    });
    const session = await group.handlers['projects:fetch'](group.event, { group: 'team' });
    expect(session.projects).toHaveLength(2);
    const directory = await group.handlers['directory:select'](group.event);
    await expect(group.handlers['clone:start'](group.event, {
      sessionId: session.sessionId,
      projectIds: [999],
      directoryId: directory.directoryId,
    })).rejects.toThrow(/project IDs/i);
    const clone = await group.handlers['clone:start'](group.event, {
      sessionId: session.sessionId, projectIds: [1], directoryId: directory.directoryId, updateExisting: true,
    });
    await flush();
    expect(group.registry.status(clone.operationId, 7)).toMatchObject({ status: 'failed' });
    expect(group.sent.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: clone.operationId, status: 'running', entityId: 1 }),
      expect.objectContaining({ operationId: clone.operationId, status: 'failed' }),
    ]));

    const missing = fixture();
    await expect(missing.handlers['projects:fetch'](missing.event, {}))
      .resolves.toMatchObject({ success: false });

    const failed = fixture({
      core: { getUserProjects: jest.fn().mockRejectedValue(new Error('project fetch failed')) },
    });
    await failed.handlers['settings:save'](failed.event, {
      gitlabUrl: 'https://gitlab.example.com', token: 'token',
    });
    await expect(failed.handlers['projects:fetch'](failed.event, {})).rejects.toThrow('project fetch failed');
  });

  test('plans and executes transfers with true partial and failed states', async () => {
    const transfer = fixture({
      core: {
        planTransfer: jest.fn().mockResolvedValue({ warnings: [], entities: [{ id: 'one' }] }),
        executeTransfer: jest.fn().mockImplementation(async (_plan, options) => {
          options.onEvent({ entityId: 'one', phase: 'git_sync', status: 'running' });
          return { status: 'partial', failures: [{ message: 'conflict' }] };
        }),
      },
    });
    await expect(transfer.handlers['transfer:plan'](transfer.event, {}))
      .resolves.toMatchObject({ success: false });
    await transfer.handlers['settings:save'](transfer.event, {
      sourceToken: 'source', destinationToken: 'destination',
    });
    const planned = await transfer.handlers['transfer:plan'](transfer.event, {
      source: { url: 'https://source.example.com', fullPath: 'team', type: 'group' },
      destination: { url: 'https://destination.example.com', namespace: 'archive' },
    });
    expect(JSON.stringify(planned)).not.toContain('source');
    const started = await transfer.handlers['transfer:start'](transfer.event, { planId: planned.planId });
    await flush();
    expect(transfer.registry.status(started.operationId, 7)).toMatchObject({ status: 'partial' });
    expect(transfer.sent.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: started.operationId, entityId: 'one' }),
      expect.objectContaining({ operationId: started.operationId, status: 'partial' }),
    ]));

    const failed = fixture({
      core: { executeTransfer: jest.fn().mockRejectedValue(new Error('transfer crashed')) },
    });
    await failed.handlers['settings:save'](failed.event, { sourceToken: 's', destinationToken: 'd' });
    const failedPlan = await failed.handlers['transfer:plan'](failed.event, { source: {}, destination: {} });
    const failedRun = await failed.handlers['transfer:start'](failed.event, { planId: failedPlan.planId });
    await flush();
    expect(failed.registry.status(failedRun.operationId, 7)).toMatchObject({ status: 'failed' });
  });

  test('selects, validates, previews, and rewrites history using issued resource IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-electron-mapping-'));
    const mappingPath = join(root, 'mapping.json');
    await writeFile(mappingPath, JSON.stringify({ schemaVersion: 1, mappings: [{ match: {}, replace: {} }] }));
    let currentTime = 1_000_000;
    const rewrite = fixture({
      selectDirectory: jest.fn().mockResolvedValue('/allowed/output'),
      selectRepository: jest.fn().mockResolvedValue('/allowed/source.git'),
      selectMapping: jest.fn().mockResolvedValue(mappingPath),
      now: () => currentTime,
    });
    await rewrite.handlers['settings:save'](rewrite.event, {
      sourceToken: 'source', destinationToken: 'destination',
    });
    const repository = await rewrite.handlers['rewrite:select-repository'](rewrite.event);
    const mapping = await rewrite.handlers['rewrite:select-mapping'](rewrite.event);
    const directory = await rewrite.handlers['directory:select'](rewrite.event);
    await expect(rewrite.handlers['rewrite:start'](rewrite.event, {
      repositoryId: repository.repositoryId,
      mappingId: mapping.mappingId,
      outputDirectoryId: directory.directoryId,
      outputName: 'without-preview.git',
      push: true,
      confirmation: 'confirmed',
    })).rejects.toThrow('successful preview');
    const preview = await rewrite.handlers['rewrite:preview'](rewrite.event, {
      repositoryId: repository.repositoryId, mappingId: mapping.mappingId,
    });
    await flush();
    expect(rewrite.registry.status(preview.operationId, 7)).toMatchObject({ status: 'finished' });

    currentTime += 5 * 60 * 1_000 + 1;
    await expect(rewrite.handlers['rewrite:start'](rewrite.event, {
      repositoryId: repository.repositoryId,
      mappingId: mapping.mappingId,
      outputDirectoryId: directory.directoryId,
      outputName: 'stale-preview.git',
      push: true,
      confirmation: 'confirmed',
      previewId: preview.operationId,
    })).rejects.toThrow('fresh preview');
    currentTime = 1_000_000;

    await expect(rewrite.handlers['rewrite:start'](rewrite.event, {
      repositoryId: repository.repositoryId,
      mappingId: mapping.mappingId,
      outputDirectoryId: directory.directoryId,
      outputName: '../escape',
    })).rejects.toThrow('safe directory name');
    const started = await rewrite.handlers['rewrite:start'](rewrite.event, {
      repositoryId: repository.repositoryId,
      mappingId: mapping.mappingId,
      outputDirectoryId: directory.directoryId,
      outputName: 'rewritten.git',
      push: true,
      confirmation: 'confirmed',
      previewId: preview.operationId,
    });
    await flush();
    expect(rewrite.core.rewriteHistory).toHaveBeenCalledWith(expect.objectContaining({
      repository: '/allowed/source.git',
      output: '/allowed/output/rewritten.git',
      token: 'source',
      destinationToken: 'destination',
      preview: expect.objectContaining({ status: 'preview' }),
    }), expect.any(Object));
    expect(rewrite.registry.status(started.operationId, 7)).toMatchObject({ status: 'finished' });
    await expect(rewrite.handlers['rewrite:start'](rewrite.event, {
      repositoryId: repository.repositoryId,
      mappingId: mapping.mappingId,
      outputDirectoryId: directory.directoryId,
      outputName: 'reused-preview.git',
      push: true,
      confirmation: 'confirmed',
      previewId: preview.operationId,
    })).rejects.toThrow('successful preview');

    rewrite.core.rewriteHistory.mockResolvedValueOnce({
      status: 'failed', backupPath: '/allowed/output/failed.bundle', error: 'lease conflict',
    });
    const failed = await rewrite.handlers['rewrite:start'](rewrite.event, {
      repositoryId: repository.repositoryId,
      mappingId: mapping.mappingId,
      outputDirectoryId: directory.directoryId,
      outputName: 'failed.git',
    });
    await flush();
    expect(rewrite.registry.status(failed.operationId, 7)).toMatchObject({ status: 'failed' });
    expect(rewrite.sent.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: failed.operationId, status: 'failed' }),
    ]));
  });

  test('handles canceled rewrite pickers, operation controls, and shutdown', async () => {
    const canceled = fixture({
      selectRepository: jest.fn().mockResolvedValue(null),
      selectMapping: jest.fn().mockResolvedValue(null),
    });
    await expect(canceled.handlers['rewrite:select-repository'](canceled.event))
      .resolves.toEqual({ success: false, canceled: true });
    await expect(canceled.handlers['rewrite:select-mapping'](canceled.event))
      .resolves.toEqual({ success: false, canceled: true });

    const operation = canceled.registry.begin('test', 7);
    await expect(canceled.handlers['operation:status'](canceled.event, { operationId: operation.id }))
      .resolves.toMatchObject({ success: true, status: 'running' });
    await expect(canceled.handlers['operation:cancel'](canceled.event, { operationId: operation.id }))
      .resolves.toMatchObject({ success: true, status: 'canceled' });
    await expect(canceled.handlers['app:shutdown'](canceled.event)).resolves.toEqual({ success: true });
    expect(canceled.quit).toHaveBeenCalled();
  });

  test('registers every IPC handler after removing stale registrations', () => {
    const ipcMain = { removeHandler: jest.fn(), handle: jest.fn() };
    registerIpcHandlers(ipcMain, { one: jest.fn(), two: jest.fn() });
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(2);
    expect(ipcMain.handle).toHaveBeenCalledTimes(2);
  });

  test('safeOAuthUrl accepts only HTTPS on the exact expected origin', () => {
    expect(safeOAuthUrl('https://gitlab.example.com/oauth', 'https://gitlab.example.com'))
      .toBe('https://gitlab.example.com/oauth');
    expect(() => safeOAuthUrl('http://gitlab.example.com/oauth', 'http://gitlab.example.com')).toThrow();
    expect(() => safeOAuthUrl('https://evil.example.com/oauth', 'https://gitlab.example.com')).toThrow();
    expect(() => safeOAuthUrl(
      'https://oauth2:secret@gitlab.example.com/oauth',
      'https://gitlab.example.com',
    )).toThrow();
  });
});
