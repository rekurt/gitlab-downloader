const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

function safeOAuthUrl(value, expectedOrigin) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' || url.origin !== expectedOrigin ||
    url.username || url.password
  ) {
    throw new Error('OAuth URL has an unexpected origin');
  }
  return url.toString();
}

function createIpcHandlers(dependencies) {
  const {
    store,
    safeStorage,
    registry,
    core,
    isTrustedSender,
    selectDirectory = async () => null,
    selectRepository = selectDirectory,
    selectMapping = async () => null,
    openExternal = async () => {},
    openPath = async () => '',
    quit = () => {},
    now = Date.now,
    rewritePreviewMaxAgeMs = 5 * 60 * 1_000,
  } = dependencies;
  const memorySecrets = new Map();
  const directories = new Map();
  const repositories = new Map();
  const projectSessions = new Map();
  const plans = new Map();
  const oauthUrls = new Map();
  const rewriteRepositories = new Map();
  const rewriteMappings = new Map();
  const rewritePreviews = new Map();
  const publicSettingNames = [
    'gitlabUrl',
    'group',
    'maxConcurrency',
    'oauthClientId',
    'oauthScope',
  ];
  const secretNames = ['token', 'sourceToken', 'destinationToken', 'oauthToken'];

  function saveSecret(name, value) {
    if (!value) return;
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(String(value)).toString('base64');
      store.set(`secrets.${name}`, encrypted);
      memorySecrets.delete(name);
    } else {
      memorySecrets.set(name, String(value));
    }
  }

  function loadSecret(name) {
    if (memorySecrets.has(name)) return memorySecrets.get(name);
    const encrypted = store.get(`secrets.${name}`, null);
    if (!encrypted || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }

  function sourceToken() {
    return loadSecret('oauthToken') || loadSecret('sourceToken') || loadSecret('token');
  }

  function destinationToken() {
    return loadSecret('destinationToken') || loadSecret('token');
  }

  function pickPublicSettings(settings = {}) {
    return Object.fromEntries(publicSettingNames
      .filter((name) => Object.hasOwn(settings, name))
      .map((name) => [name, settings[name]]));
  }

  function migrateLegacySettings() {
    const stored = store.get('settings', {});
    const publicSettings = pickPublicSettings(stored);
    for (const name of secretNames) saveSecret(name, stored[name]);
    if (Object.keys(stored).some((name) => !publicSettingNames.includes(name))) {
      store.set('settings', publicSettings);
    }
    return publicSettings;
  }

  function send(event, payload) {
    if (!event.sender.isDestroyed?.()) event.sender.send('operation:event', payload);
  }

  function ownedResource(collection, id, ownerId, label) {
    const item = collection.get(id);
    if (!item || item.ownerId !== ownerId) throw new Error(`Unknown ${label} ID`);
    return item;
  }

  const raw = {
    'settings:load': async () => ({
      ...migrateLegacySettings(),
      hasToken: Boolean(loadSecret('token')),
      hasSourceToken: Boolean(loadSecret('sourceToken')),
      hasDestinationToken: Boolean(loadSecret('destinationToken')),
      hasOAuthToken: Boolean(loadSecret('oauthToken')),
    }),

    'settings:save': async (_event, settings = {}) => {
      const publicSettings = pickPublicSettings(settings);
      if (publicSettings.gitlabUrl && !core.validateGitlabUrl(publicSettings.gitlabUrl)) {
        return { success: false, error: 'Invalid GitLab URL' };
      }
      for (const name of secretNames) {
        saveSecret(name, settings[name]);
      }
      store.set('settings', publicSettings);
      return { success: true, settings: publicSettings };
    },

    'connection:test': async (_event, values = {}) => {
      const url = String(values.gitlabUrl || '').replace(/\/+$/, '');
      const token = sourceToken();
      if (!url || !token) return { success: false, error: 'GitLab URL and saved token are required' };
      const profile = await core.getCurrentUser({ url, token });
      return { success: true, profile: { username: profile.username, name: profile.name } };
    },

    'directory:select': async (event) => {
      const selectedPath = await selectDirectory();
      if (!selectedPath) return { success: false, canceled: true };
      const directoryId = randomUUID();
      directories.set(directoryId, { ownerId: event.sender.id, path: selectedPath });
      return { success: true, directoryId, displayPath: selectedPath };
    },

    'repositories:list': async (event, { directoryId } = {}) => {
      const directory = ownedResource(directories, directoryId, event.sender.id, 'directory');
      const discovered = core.findGitRepositories(directory.path);
      const result = discovered.map((repository) => {
        const repositoryId = randomUUID();
        repositories.set(repositoryId, { ownerId: event.sender.id, ...repository });
        return {
          repositoryId,
          name: repository.name,
          url: repository.url,
          lastUpdated: repository.last_updated,
        };
      });
      return { success: true, repositories: result };
    },

    'repository:open': async (event, { repositoryId } = {}) => {
      const repository = ownedResource(repositories, repositoryId, event.sender.id, 'repository');
      const error = await openPath(repository.path);
      return error ? { success: false, error } : { success: true };
    },

    'oauth:start': async (event, values = {}) => {
      const url = String(values.gitlabUrl || '').replace(/\/+$/, '');
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('OAuth requires an HTTPS GitLab URL');
      if (parsed.username || parsed.password) {
        throw new Error('OAuth GitLab URLs must not contain embedded credentials');
      }
      if (parsed.search || parsed.hash) {
        throw new Error('OAuth GitLab URLs must not contain a query or fragment');
      }
      const config = {
        url,
        authMethod: 'oauth',
        oauthClientId: String(values.oauthClientId || ''),
        oauthScope: String(values.oauthScope || 'api'),
      };
      if (!config.oauthClientId) return { success: false, error: 'OAuth Client ID is required' };
      const operation = registry.begin('oauth', event.sender.id);
      try {
        const device = await core.deviceAuthorize(config, { signal: operation.signal });
        const verificationUri = safeOAuthUrl(device.verification_uri, parsed.origin);
        const verificationUriComplete = device.verification_uri_complete
          ? safeOAuthUrl(device.verification_uri_complete, parsed.origin)
          : '';
        oauthUrls.set(operation.id, verificationUriComplete || verificationUri);
        Promise.resolve().then(async () => {
          try {
            const tokenPayload = await core.pollDeviceToken(
              config,
              String(device.device_code || ''),
              Number(device.interval) || 5,
              Number(device.expires_in) || 300,
              { signal: operation.signal },
            );
            const profile = await core.getCurrentUser(
              { url, token: tokenPayload.access_token },
              { signal: operation.signal },
            );
            if (operation.signal.aborted) {
              throw operation.signal.reason ?? new DOMException('Canceled', 'AbortError');
            }
            saveSecret('oauthToken', tokenPayload.access_token);
            const safeResult = { profile: { username: profile.username, name: profile.name } };
            registry.complete(operation.id, safeResult);
            send(event, { operationId: operation.id, status: 'finished', ...safeResult });
          } catch (error) {
            registry.fail(operation.id, error);
            send(event, {
              operationId: operation.id,
              status: operation.signal.aborted ? 'canceled' : 'failed',
              message: operation.signal.aborted ? 'OAuth authorization canceled' : error.message,
            });
          }
        });
        return {
          success: true,
          operationId: operation.id,
          verificationUri,
          userCode: String(device.user_code || ''),
        };
      } catch (error) {
        registry.fail(operation.id, error);
        throw error;
      }
    },

    'oauth:open': async (event, { operationId } = {}) => {
      registry.status(operationId, event.sender.id);
      const url = oauthUrls.get(operationId);
      if (!url) throw new Error('OAuth URL is not available');
      await openExternal(url);
      return { success: true };
    },

    'projects:fetch': async (event, { group } = {}) => {
      const settings = store.get('settings', {});
      const token = sourceToken();
      if (!settings.gitlabUrl || !token) return { success: false, error: 'GitLab URL and saved token are required' };
      const config = { url: settings.gitlabUrl, token, group: group || settings.group || null };
      const operation = registry.begin('fetch', event.sender.id);
      try {
        const projects = config.group
          ? await core.getAllProjects(
              config,
              (await core.fetchGroupMetadata(config, { signal: operation.signal })).full_path,
              { signal: operation.signal },
            )
          : await core.getUserProjects(config, { signal: operation.signal });
        const sessionId = randomUUID();
        projectSessions.set(sessionId, { ownerId: event.sender.id, projects });
        registry.complete(operation.id, { count: projects.length });
        return {
          success: true,
          sessionId,
          projects: projects.map((project) => ({
            id: project.id,
            fullPath: project.path_with_namespace,
            name: project.name,
          })),
        };
      } catch (error) {
        registry.fail(operation.id, error);
        throw error;
      }
    },

    'clone:start': async (event, { sessionId, projectIds, directoryId, updateExisting = false } = {}) => {
      const session = ownedResource(projectSessions, sessionId, event.sender.id, 'project session');
      const directory = ownedResource(directories, directoryId, event.sender.id, 'directory');
      if (!Array.isArray(projectIds) || projectIds.length === 0) {
        throw new Error('At least one project ID is required');
      }
      const selected = session.projects.filter((project) => projectIds.includes(project.id));
      if (selected.length !== new Set(projectIds).size) {
        throw new Error('One or more project IDs are not part of this session');
      }
      const settings = store.get('settings', {});
      const operation = registry.begin('clone', event.sender.id);
      Promise.resolve().then(async () => {
        try {
          const results = await core.cloneAllRepositories(selected, {
            url: settings.gitlabUrl,
            token: sourceToken(),
            clonePath: directory.path,
            updateExisting,
            maxConcurrency: settings.maxConcurrency || 4,
          }, {
            signal: operation.signal,
            onResult: (result) => send(event, {
              operationId: operation.id,
              status: 'running',
              entityId: result.id,
              result,
            }),
          });
          const failedCount = results.filter((result) => result.status === 'failed').length;
          const status = operation.signal.aborted
            ? 'canceled'
            : failedCount === results.length
              ? 'failed'
              : failedCount > 0
                ? 'partial'
                : 'finished';
          const result = { status, repositories: results };
          registry.complete(operation.id, result);
          const message = status === 'failed'
            ? 'All selected repositories failed'
            : status === 'partial'
              ? `${failedCount} selected repositories failed`
              : status === 'canceled'
                ? 'Clone canceled'
                : 'Clone completed';
          send(event, { operationId: operation.id, status, message, result });
        } catch (error) {
          registry.fail(operation.id, error);
          send(event, { operationId: operation.id, status: operation.signal.aborted ? 'canceled' : 'failed', message: error.message });
        }
      });
      return { success: true, operationId: operation.id };
    },

    'transfer:plan': async (event, input = {}) => {
      const source = sourceToken();
      const destination = destinationToken();
      if (!source || !destination) return { success: false, error: 'Source and destination PATs must be saved first' };
      const plan = await core.planTransfer({
        source: { ...input.source, token: source },
        destination: { ...input.destination, token: destination },
      });
      const planId = randomUUID();
      plans.set(planId, { ownerId: event.sender.id, plan });
      return { success: true, planId, plan };
    },

    'transfer:start': async (event, { planId } = {}) => {
      const item = ownedResource(plans, planId, event.sender.id, 'plan');
      const operation = registry.begin('transfer', event.sender.id);
      Promise.resolve().then(async () => {
        try {
          const result = await core.executeTransfer(item.plan, {
            sourceToken: sourceToken(),
            destinationToken: destinationToken(),
            runId: operation.id,
            signal: operation.signal,
            onEvent: (transferEvent) => send(event, { operationId: operation.id, ...transferEvent }),
          });
          registry.complete(operation.id, result);
          send(event, { operationId: operation.id, status: result.status, result });
        } catch (error) {
          registry.fail(operation.id, error);
          send(event, { operationId: operation.id, status: operation.signal.aborted ? 'canceled' : 'failed', message: error.message });
        }
      });
      return { success: true, operationId: operation.id };
    },

    'rewrite:select-repository': async (event) => {
      const repositoryPath = await selectRepository();
      if (!repositoryPath) return { success: false, canceled: true };
      const repositoryId = randomUUID();
      rewriteRepositories.set(repositoryId, { ownerId: event.sender.id, path: repositoryPath });
      return { success: true, repositoryId, displayPath: repositoryPath };
    },

    'rewrite:select-mapping': async (event) => {
      const mappingPath = await selectMapping();
      if (!mappingPath) return { success: false, canceled: true };
      const mapping = core.validateHistoryMapping(JSON.parse(await readFile(mappingPath, 'utf8')));
      const mappingId = randomUUID();
      rewriteMappings.set(mappingId, { ownerId: event.sender.id, mapping });
      return { success: true, mappingId, displayPath: mappingPath, ruleCount: mapping.mappings.length };
    },

    'rewrite:preview': async (event, { repositoryId, mappingId } = {}) => {
      const repository = ownedResource(rewriteRepositories, repositoryId, event.sender.id, 'rewrite repository');
      const mapping = ownedResource(rewriteMappings, mappingId, event.sender.id, 'mapping');
      const operation = registry.begin('history-rewrite-preview', event.sender.id);
      Promise.resolve().then(async () => {
        try {
          const result = await core.previewHistoryRewrite({
            repository: repository.path,
            mapping: mapping.mapping,
            token: sourceToken(),
          }, { signal: operation.signal });
          rewritePreviews.set(operation.id, {
            ownerId: event.sender.id,
            repositoryId,
            mappingId,
            result,
            createdAt: now(),
          });
          registry.complete(operation.id, result);
          send(event, { operationId: operation.id, status: 'finished', result });
        } catch (error) {
          registry.fail(operation.id, error);
          send(event, { operationId: operation.id, status: operation.signal.aborted ? 'canceled' : 'failed', message: error.message });
        }
      });
      return { success: true, operationId: operation.id };
    },

    'rewrite:start': async (event, input = {}) => {
      const repository = ownedResource(rewriteRepositories, input.repositoryId, event.sender.id, 'rewrite repository');
      const mapping = ownedResource(rewriteMappings, input.mappingId, event.sender.id, 'mapping');
      const directory = ownedResource(directories, input.outputDirectoryId, event.sender.id, 'directory');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.outputName || '')) {
        throw new Error('Output name must be a single safe directory name');
      }
      let rewritePreview = null;
      if (input.push) {
        rewritePreview = ownedResource(
          rewritePreviews,
          input.previewId,
          event.sender.id,
          'successful preview',
        );
        if (
          rewritePreview.repositoryId !== input.repositoryId ||
          rewritePreview.mappingId !== input.mappingId ||
          rewritePreview.result?.status !== 'preview'
        ) {
          throw new Error('Push requires a successful preview for the selected repository and mapping');
        }
        const previewAge = now() - rewritePreview.createdAt;
        if (previewAge < 0 || previewAge > rewritePreviewMaxAgeMs) {
          throw new Error('Push requires a fresh preview created within the last five minutes');
        }
        rewritePreviews.delete(input.previewId);
      }
      const output = join(directory.path, input.outputName);
      const operation = registry.begin('history-rewrite', event.sender.id);
      Promise.resolve().then(async () => {
        try {
          const result = await core.rewriteHistory({
            repository: repository.path,
            mapping: mapping.mapping,
            output,
            token: sourceToken(),
            destinationToken: destinationToken(),
            push: Boolean(input.push),
            confirmation: input.confirmation,
            preview: rewritePreview?.result,
          }, { signal: operation.signal });
          registry.complete(operation.id, result);
          send(event, { operationId: operation.id, status: result.status, result });
        } catch (error) {
          registry.fail(operation.id, error);
          send(event, { operationId: operation.id, status: operation.signal.aborted ? 'canceled' : 'failed', message: error.message });
        }
      });
      return { success: true, operationId: operation.id };
    },

    'operation:status': async (event, { operationId } = {}) => ({
      success: true,
      ...registry.status(operationId, event.sender.id),
    }),

    'operation:cancel': async (event, { operationId } = {}) => ({
      success: true,
      ...registry.cancel(operationId, event.sender.id),
    }),

    'app:shutdown': async () => {
      registry.cancelAll();
      quit();
      return { success: true };
    },
  };

  return Object.fromEntries(Object.entries(raw).map(([channel, handler]) => [
    channel,
    async (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted renderer');
      return handler(event, ...args);
    },
  ]));
}

function registerIpcHandlers(ipcMain, handlers) {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler?.(channel);
    ipcMain.handle(channel, handler);
  }
}

module.exports = { createIpcHandlers, registerIpcHandlers, safeOAuthUrl };
