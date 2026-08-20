const mockInvoke = jest.fn().mockResolvedValue({ success: true });
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();
const mockExposeInMainWorld = jest.fn();

jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: { invoke: mockInvoke, on: mockOn, removeListener: mockRemoveListener },
}));

describe('narrow preload bridge', () => {
  test('exposes only named IPC operations and removable operation events', async () => {
    jest.isolateModules(() => require('../preload'));
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.any(Object));
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api).not.toHaveProperty('invoke');
    expect(api).not.toHaveProperty('on');

    await api.loadSettings();
    await api.saveSettings({ gitlabUrl: 'https://gitlab.example.com' });
    await api.selectDirectory();
    await api.selectRewriteRepository();
    await api.selectRewriteMapping();
    await api.requestShutdown();
    expect(mockInvoke).toHaveBeenCalledWith('settings:load');
    expect(mockInvoke).toHaveBeenCalledWith('settings:save', { gitlabUrl: 'https://gitlab.example.com' });
    expect(mockInvoke).toHaveBeenCalledWith('directory:select');
    expect(mockInvoke).toHaveBeenCalledWith('rewrite:select-repository');
    expect(mockInvoke).toHaveBeenCalledWith('rewrite:select-mapping');
    expect(mockInvoke).toHaveBeenCalledWith('app:shutdown');

    const callback = jest.fn();
    const cleanup = api.onOperationEvent(callback);
    const listener = mockOn.mock.calls[0][1];
    listener({}, { operationId: 'one' });
    expect(callback).toHaveBeenCalledWith({ operationId: 'one' });
    cleanup();
    expect(mockRemoveListener).toHaveBeenCalledWith('operation:event', listener);
    expect(() => api.onOperationEvent(null)).toThrow('Callback is required');
  });

  test('maps every payload API to its fixed IPC channel', async () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    for (const [method, channel] of [
      ['testConnection', 'connection:test'],
      ['listRepositories', 'repositories:list'],
      ['openRepository', 'repository:open'],
      ['startOAuth', 'oauth:start'],
      ['openOAuth', 'oauth:open'],
      ['fetchProjects', 'projects:fetch'],
      ['startClone', 'clone:start'],
      ['planTransfer', 'transfer:plan'],
      ['startTransfer', 'transfer:start'],
      ['previewRewrite', 'rewrite:preview'],
      ['startRewrite', 'rewrite:start'],
      ['getOperationStatus', 'operation:status'],
      ['cancelOperation', 'operation:cancel'],
    ]) {
      await api[method]({ id: method });
      expect(mockInvoke).toHaveBeenCalledWith(channel, { id: method });
    }
  });
});
