import { z } from 'zod';

import * as gitLabApi from './gitlab-api.js';
import { syncRepository as defaultSyncRepository } from './git-sync.js';
import { inspectTransferTools } from './preflight.js';
import { redactSecrets } from './utils.js';
import {
  TransferConnectionSchema,
  TransferEventSchema,
  TransferPlanSchema,
  isDirectTransferCompatible,
} from './transfer-schema.js';
import { randomUUID } from 'node:crypto';

const activeTransfers = new Map();

const TransferRequestSchema = z
  .object({
    source: z
      .object({
        url: z.string(),
        token: z.string(),
        fullPath: z.string().min(1),
        type: z.enum(['group', 'project']),
      })
      .strict(),
    destination: z
      .object({
        url: z.string(),
        token: z.string(),
        namespace: z.string(),
      })
      .strict(),
  })
  .strict();

function normalizePath(path) {
  return path.replace(/^\/+|\/+$/g, '');
}

function leaf(path) {
  return normalizePath(path).split('/').at(-1);
}

function parent(path) {
  const parts = normalizePath(path).split('/');
  parts.pop();
  return parts.join('/');
}

function joinPath(...parts) {
  return parts.map(normalizePath).filter(Boolean).join('/');
}

function entityPlan(sourceType, sourceFullPath, destinationFullPath, mode, reason) {
  return {
    id: `${sourceType}:${sourceFullPath}`,
    sourceType,
    sourceFullPath,
    destinationFullPath,
    destinationNamespace: parent(destinationFullPath),
    destinationSlug: leaf(destinationFullPath),
    mode,
    reason,
  };
}

function readableVersion(payload, side) {
  if (!payload || typeof payload.version !== 'string' || !payload.version) {
    throw new Error(`${side} GitLab did not return a readable version`);
  }
  return payload.version;
}

export async function ensureGitOnlyEntity(entity, options) {
  const { destination, signal } = options;
  const api = options.api ?? gitLabApi;
  const apiOptions = { signal };
  const lookup = entity.sourceType === 'group' ? api.getGroup : api.getProject;
  const existing = await lookup(destination, entity.destinationFullPath, apiOptions);
  if (existing) return existing;

  const namespace = await api.getGroup(destination, entity.destinationNamespace, apiOptions);
  if (!namespace) {
    throw new Error(
      `Destination namespace ${entity.destinationNamespace} does not exist or is not writable`,
    );
  }
  if (entity.sourceType === 'group') {
    return api.createGroup(destination, {
      name: entity.destinationSlug,
      path: entity.destinationSlug,
      parentId: namespace.id,
    }, apiOptions);
  }
  return api.createProject(destination, {
    name: entity.destinationSlug,
    path: entity.destinationSlug,
    namespaceId: namespace.id,
  }, apiOptions);
}

export async function planTransfer(rawInput, options = {}) {
  const parsed = TransferRequestSchema.parse(rawInput);
  const sourceConnection = TransferConnectionSchema.parse({
    url: parsed.source.url,
    token: parsed.source.token,
  });
  const destinationConnection = TransferConnectionSchema.parse({
    url: parsed.destination.url,
    token: parsed.destination.token,
  });
  const sourceFullPath = normalizePath(parsed.source.fullPath);
  const destinationNamespace = normalizePath(parsed.destination.namespace);
  const destinationRoot = joinPath(destinationNamespace, leaf(sourceFullPath));
  const api = options.api ?? gitLabApi;
  const now = options.now ?? (() => new Date());
  const signal = options.signal;
  const apiOptions = { signal };

  const [sourceVersionPayload, destinationVersionPayload] = await Promise.all([
    api.getGitLabVersion(sourceConnection, apiOptions),
    api.getGitLabVersion(destinationConnection, apiOptions),
  ]);
  const sourceVersion = readableVersion(sourceVersionPayload, 'Source');
  const destinationVersion = readableVersion(destinationVersionPayload, 'Destination');

  await Promise.all([
    api.getCurrentUser(sourceConnection, apiOptions),
    api.getCurrentUser(destinationConnection, apiOptions),
  ]);

  const warnings = [];
  const destinationNamespaceEntity = await api.getGroup(
    destinationConnection,
    destinationNamespace,
    apiOptions,
  );
  if (!destinationNamespaceEntity) {
    throw new Error(
      `Destination namespace ${destinationNamespace} was not found or is not readable`,
    );
  }
  if (destinationNamespaceEntity.permissions) {
    const groupAccess = destinationNamespaceEntity.permissions.group_access?.access_level ?? 0;
    const projectAccess = destinationNamespaceEntity.permissions.project_access?.access_level ?? 0;
    if (Math.max(groupAccess, projectAccess) < 50) {
      throw new Error(`Owner access is required for destination namespace ${destinationNamespace}`);
    }
  } else {
    warnings.push('Owner access to the destination namespace could not be verified from the API response');
  }
  const readBulkImportSetting = async (side, connection) => {
    try {
      const settings = await api.getApplicationSettings(connection, apiOptions);
      return typeof settings?.bulk_import_enabled === 'boolean'
        ? settings.bulk_import_enabled
        : null;
    } catch (error) {
      if (error?.status !== 401 && error?.status !== 403 && error?.status !== 404) throw error;
      warnings.push(`${side} bulk-import setting could not be verified with the current token`);
      return null;
    }
  };
  const [sourceBulkImportEnabled, destinationBulkImportEnabled] = await Promise.all([
    readBulkImportSetting('Source', sourceConnection),
    readBulkImportSetting('Destination', destinationConnection),
  ]);

  const versionsCompatible = isDirectTransferCompatible(sourceVersion, destinationVersion);
  const directTransferAvailable = versionsCompatible &&
    sourceBulkImportEnabled !== false &&
    destinationBulkImportEnabled !== false;
  if (!versionsCompatible) {
    warnings.push(
      `Direct Transfer is unavailable for GitLab ${sourceVersion} -> ${destinationVersion}; ` +
        'using Git-only fallback',
    );
  }
  if (sourceBulkImportEnabled === false) {
    warnings.push('Direct Transfer is disabled on the source GitLab');
  }
  if (destinationBulkImportEnabled === false) {
    warnings.push('Direct Transfer is disabled on the destination GitLab');
  }

  const entities = [];
  const sourceLookup = parsed.source.type === 'group' ? api.getGroup : api.getProject;
  const sourceEntity = await sourceLookup(sourceConnection, sourceFullPath, apiOptions);
  if (!sourceEntity) {
    throw new Error(
      `Source ${parsed.source.type} ${sourceFullPath} was not found or is not readable`,
    );
  }
  if (sourceEntity.permissions) {
    const groupAccess = sourceEntity.permissions.group_access?.access_level ?? 0;
    const projectAccess = sourceEntity.permissions.project_access?.access_level ?? 0;
    if (Math.max(groupAccess, projectAccess) < 50) {
      throw new Error(
        `Owner access is required for source ${parsed.source.type} ${sourceFullPath}`,
      );
    }
  } else {
    warnings.push(
      `Owner access to source ${parsed.source.type} ${sourceFullPath} could not be verified from the API response`,
    );
  }

  if (parsed.source.type === 'project') {
    const destinationProject = await api.getProject(
      destinationConnection,
      destinationRoot,
      apiOptions,
    );
    const mode = destinationProject
      ? 'git_sync'
      : directTransferAvailable
        ? 'direct_transfer'
        : 'git_only_fallback';
    const reason = destinationProject
      ? 'destination project already exists; platform data will not be merged'
      : directTransferAvailable
        ? 'destination project does not exist'
        : 'Direct Transfer is unavailable; create a Git-only project';
    entities.push(entityPlan('project', sourceFullPath, destinationRoot, mode, reason));
  } else {
    const destinationGroup = await api.getGroup(
      destinationConnection,
      destinationRoot,
      apiOptions,
    );

    const walkGroup = async (currentSourcePath, currentDestinationPath, targetExists) => {
      if (!targetExists && directTransferAvailable) {
        entities.push(
          entityPlan(
            'group',
            currentSourcePath,
            currentDestinationPath,
            'direct_transfer',
            'destination group does not exist',
          ),
        );
        return;
      }

      if (!targetExists) {
        entities.push(
          entityPlan(
            'group',
            currentSourcePath,
            currentDestinationPath,
            'git_only_fallback',
            'Direct Transfer is unavailable; create a Git-only group',
          ),
        );
      }

      const projects = await api.listGroupProjects(sourceConnection, currentSourcePath, apiOptions);
      for (const project of projects) {
        const projectSourcePath = normalizePath(project.path_with_namespace);
        const projectDestinationPath = joinPath(currentDestinationPath, project.path);
        const destinationProject = targetExists
          ? await api.getProject(destinationConnection, projectDestinationPath, apiOptions)
          : null;
        if (destinationProject) {
          entities.push(
            entityPlan(
              'project',
              projectSourcePath,
              projectDestinationPath,
              'git_sync',
              'destination project already exists; platform data will not be merged',
            ),
          );
        } else {
          entities.push(
            entityPlan(
              'project',
              projectSourcePath,
              projectDestinationPath,
              directTransferAvailable ? 'direct_transfer' : 'git_only_fallback',
              directTransferAvailable
                ? 'destination project does not exist'
                : 'Direct Transfer is unavailable; create a Git-only project',
            ),
          );
        }
      }

      const children = await api.listSubgroups(sourceConnection, currentSourcePath, apiOptions);
      for (const subgroup of children) {
        const childSourcePath = normalizePath(subgroup.full_path);
        const childDestinationPath = joinPath(currentDestinationPath, subgroup.path);
        const destinationSubgroup = targetExists
          ? await api.getGroup(destinationConnection, childDestinationPath, apiOptions)
          : null;
        await walkGroup(childSourcePath, childDestinationPath, Boolean(destinationSubgroup));
      }
    };

    await walkGroup(sourceFullPath, destinationRoot, Boolean(destinationGroup));
  }

  const gitModes = new Set(['git_sync', 'git_only_fallback']);
  if (entities.some((entity) => gitModes.has(entity.mode))) {
    const inspectTools = options.inspectTools ?? inspectTransferTools;
    const tools = await inspectTools({ signal });
    if (!tools.git) {
      for (const entity of entities) {
        if (gitModes.has(entity.mode)) {
          entity.mode = 'blocked';
          entity.reason = 'git is required for repository synchronization';
        }
      }
    } else if (!tools.gitLfs) {
      warnings.push('git-lfs is unavailable; repositories using LFS cannot be fully synchronized');
    }
  }

  return TransferPlanSchema.parse({
    schemaVersion: 1,
    createdAt: now().toISOString(),
    source: {
      url: sourceConnection.url,
      version: sourceVersion,
      fullPath: sourceFullPath,
      type: parsed.source.type,
    },
    destination: {
      url: destinationConnection.url,
      version: destinationVersion,
      namespace: destinationNamespace,
    },
    entities,
    warnings,
  });
}

function transferEvent(runId, phase, status, message, entityId = null, progress) {
  const terminal = ['finished', 'partial', 'failed', 'canceled', 'blocked'].includes(status);
  return TransferEventSchema.parse({
    runId,
    entityId,
    phase,
    status,
    progress: progress ?? (terminal ? 1 : status === 'started' ? 0 : 0.5),
    message,
  });
}

function safeRunState(state) {
  return {
    runId: state.runId,
    status: state.status,
    bulkImportId: state.bulkImportId,
  };
}

function waitForPoll(milliseconds, signal) {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
  });
}

function transferResult(state, failures, entityResults, plan) {
  const supported = entityResults
    .filter((entity) => ['finished', 'created', 'success'].includes(entity.status))
    .map((entity) => entity.sourceFullPath || entity.id);
  const skipped = plan.entities
    .filter((entity) => entity.mode === 'blocked')
    .map((entity) => entity.id);
  const conflicts = entityResults.flatMap((entity) =>
    (entity.conflicts || []).map((ref) => ({ entityId: entity.id, ref })),
  );
  return {
    ...safeRunState(state),
    failures,
    entities: entityResults,
    warnings: plan.warnings,
    summary: { supported, skipped, conflicts },
  };
}

function failureRecord(entityId, failure, secrets) {
  return {
    entityId,
    relation: redactSecrets(failure.relation ?? 'unknown', secrets),
    correlationId: failure.correlation_id_value === null ||
      failure.correlation_id_value === undefined
      ? null
      : redactSecrets(failure.correlation_id_value, secrets),
    message: redactSecrets(
      failure.exception_message ?? 'GitLab reported an import failure',
      secrets,
    ),
  };
}

export async function executeTransfer(rawPlan, options = {}) {
  const plan = TransferPlanSchema.parse(rawPlan);
  const {
    sourceToken,
    destinationToken,
    api = gitLabApi,
    pollIntervalMs = 2_000,
    onEvent = () => {},
    onStateChange = () => {},
    syncRepository: syncHandler = defaultSyncRepository,
    ensureFallbackEntity = ensureGitOnlyEntity,
    resumeBulkImportId = null,
    runId = randomUUID(),
    signal,
  } = options;
  if (!sourceToken || !destinationToken) {
    throw new Error('Source and destination tokens are required to execute a transfer');
  }
  const secrets = [sourceToken, destinationToken];
  if (activeTransfers.has(runId)) throw new Error(`Transfer ${runId} already exists`);

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  const source = { url: plan.source.url, token: sourceToken };
  const destination = { url: plan.destination.url, token: destinationToken };
  const state = {
    runId,
    status: 'starting',
    bulkImportId: null,
    controller,
    destination,
    plan,
  };
  activeTransfers.set(runId, state);
  const notifyState = () => onStateChange(safeRunState(state));
  await notifyState();

  const emit = (phase, status, message, entityId, progress) => {
    onEvent(transferEvent(runId, phase, status, message, entityId, progress));
  };
  const failures = [];
  const entityResults = [];
  let hasHardFailures = false;
  let hasPartialResults = false;

  try {
    const directEntities = plan.entities.filter((entity) => entity.mode === 'direct_transfer');
    if (directEntities.length > 0) {
      if (resumeBulkImportId !== null && resumeBulkImportId !== undefined) {
        state.bulkImportId = resumeBulkImportId;
      } else {
        const started = await api.startBulkImport(destination, source, directEntities, {
          signal: controller.signal,
        });
        state.bulkImportId = started.id;
      }
      state.status = 'running';
      await notifyState();
      emit(
        'direct_transfer',
        'started',
        resumeBulkImportId === null || resumeBulkImportId === undefined
          ? 'GitLab Direct Transfer started'
          : 'Resuming GitLab Direct Transfer polling',
      );

      const terminalStatuses = new Set(['finished', 'failed', 'canceled', 'timeout']);
      let remote;
      do {
        remote = await api.getBulkImport(destination, state.bulkImportId, {
          signal: controller.signal,
        });
        emit(
          'direct_transfer',
          'running',
          `GitLab Direct Transfer status: ${redactSecrets(remote.status, secrets)}`,
        );
        if (!terminalStatuses.has(remote.status)) {
          await waitForPoll(pollIntervalMs, controller.signal);
        }
      } while (!terminalStatuses.has(remote.status));

      if (remote.status === 'canceled') {
        state.status = 'canceled';
        await notifyState();
        emit('complete', 'canceled', 'Transfer canceled');
        return transferResult(state, failures, entityResults, plan);
      }

      const remoteEntities = await api.getBulkImportEntities(destination, state.bulkImportId, {
        signal: controller.signal,
      });
      const plannedDirectByPath = new Map(
        directEntities.map((entity) => [normalizePath(entity.sourceFullPath), entity]),
      );
      const returnedDirectPaths = new Set();
      for (const remoteEntity of remoteEntities) {
        const remoteSourcePath = remoteEntity.source_full_path
          ? normalizePath(remoteEntity.source_full_path)
          : '';
        const plannedEntity = plannedDirectByPath.get(remoteSourcePath);
        if (!plannedEntity) {
          failures.push({
            entityId: remoteEntity.id,
            relation: 'entity',
            correlationId: null,
            message: remoteSourcePath
              ? `GitLab returned an unexpected Direct Transfer entity: ${remoteSourcePath}`
              : 'GitLab returned a Direct Transfer entity without a source path',
          });
        } else if (returnedDirectPaths.has(remoteSourcePath)) {
          failures.push({
            entityId: remoteEntity.id,
            relation: 'entity',
            correlationId: null,
            message: `GitLab returned duplicate Direct Transfer results for ${remoteSourcePath}`,
          });
        } else {
          returnedDirectPaths.add(remoteSourcePath);
        }
        entityResults.push({
          id: remoteEntity.id,
          sourceFullPath: remoteEntity.source_full_path
            ? redactSecrets(remoteEntity.source_full_path, secrets)
            : null,
          status: redactSecrets(remoteEntity.status ?? 'unknown', secrets),
          mode: 'direct_transfer',
        });
        if (
          remoteEntity.status !== 'finished'
        ) {
          failures.push({
            entityId: remoteEntity.id,
            relation: 'entity',
            correlationId: null,
            message: `Direct Transfer entity ended as ${remoteEntity.status}`,
          });
        }
        if (remoteEntity.has_failures) {
          const remoteFailures = await api.getBulkImportFailures(
            destination,
            state.bulkImportId,
            remoteEntity.id,
            { signal: controller.signal },
          );
          failures.push(...remoteFailures.map((item) =>
            failureRecord(remoteEntity.id, item, secrets),
          ));
        }
      }
      for (const directEntity of directEntities) {
        if (returnedDirectPaths.has(normalizePath(directEntity.sourceFullPath))) continue;
        entityResults.push({
          id: directEntity.id,
          sourceFullPath: directEntity.sourceFullPath,
          status: 'missing',
          mode: 'direct_transfer',
        });
        failures.push({
          entityId: directEntity.id,
          relation: 'entity',
          correlationId: null,
          message: `GitLab did not return a terminal result for ${directEntity.sourceFullPath}`,
        });
      }
      const directEntityFailed = remoteEntities.some((entity) =>
        entity.status !== 'finished',
      ) || returnedDirectPaths.size !== directEntities.length;
      if (
        ['failed', 'timeout'].includes(remote.status) || remote.has_failures ||
        directEntityFailed || failures.length > 0
      ) {
        if (failures.length === 0) {
          failures.push({
            entityId: null,
            relation: 'bulk_import',
            correlationId: null,
            message: `Direct Transfer ended as ${remote.status}`,
          });
        }
        state.status = 'failed';
        await notifyState();
        emit('complete', 'failed', 'Direct Transfer completed with failures');
        return transferResult(state, failures, entityResults, plan);
      }
    }

    for (const entity of plan.entities.filter((item) => item.mode !== 'direct_transfer')) {
      try {
      if (entity.mode === 'blocked') {
        hasHardFailures = true;
        emit('fallback', 'blocked', entity.reason, entity.id);
        entityResults.push({ id: entity.id, mode: entity.mode, status: 'blocked' });
        failures.push({
          entityId: entity.id,
          relation: 'entity',
          correlationId: null,
          message: entity.reason,
        });
        continue;
      }
      if (entity.mode === 'git_only_fallback') {
        if (typeof ensureFallbackEntity !== 'function') {
          throw new Error('Git-only fallback handler is not configured');
        }
        emit('fallback', 'started', `Creating ${entity.destinationFullPath}`, entity.id);
        await ensureFallbackEntity(entity, {
          source,
          destination,
          signal: controller.signal,
          api,
        });
        if (entity.sourceType === 'group') {
          entityResults.push({
            id: entity.id,
            sourceFullPath: entity.sourceFullPath,
            mode: entity.mode,
            status: 'created',
          });
        }
        emit('fallback', 'finished', `Created ${entity.destinationFullPath}`, entity.id);
      }
      if (entity.sourceType === 'project') {
        if (typeof syncHandler !== 'function') {
          throw new Error('Git synchronization handler is not configured');
        }
        emit('git_sync', 'started', `Synchronizing ${entity.sourceFullPath}`, entity.id);
        const result = await syncHandler(entity, {
          source,
          destination,
          signal: controller.signal,
          onEvent: (gitEvent) => emit(
            'git_sync',
            gitEvent.status ?? 'running',
            gitEvent.message ?? `Synchronizing ${entity.sourceFullPath}`,
            entity.id,
            gitEvent.progress,
          ),
        });
        entityResults.push({
          id: entity.id,
          sourceFullPath: entity.sourceFullPath,
          mode: entity.mode,
          ...result,
        });
        emit(
          'git_sync',
          result.status,
          result.status === 'finished'
            ? `Synchronized ${entity.sourceFullPath}`
            : `Synchronization of ${entity.sourceFullPath} completed as ${result.status}`,
          entity.id,
          1,
        );
        if (result.status === 'failed') {
          hasHardFailures = true;
          failures.push({
            entityId: entity.id,
            relation: 'repository',
            correlationId: null,
            message: result.message ?? 'Git synchronization failed',
          });
        } else if (result.status === 'partial') {
          hasPartialResults = true;
          failures.push({
            entityId: entity.id,
            relation: 'repository',
            correlationId: null,
            message: result.conflicts?.length
              ? `Conflicting refs were left unchanged: ${result.conflicts.join(', ')}`
              : result.lfs?.message ?? result.message ?? 'Git synchronization was only partially completed',
          });
        }
      }
      } catch (error) {
        if (controller.signal.aborted) throw error;
        hasHardFailures = true;
        const message = redactSecrets(error.message || String(error), [
          sourceToken,
          destinationToken,
        ]);
        entityResults.push({
          id: entity.id,
          sourceFullPath: entity.sourceFullPath,
          mode: entity.mode,
          status: 'failed',
          message,
        });
        failures.push({
          entityId: entity.id,
          relation: entity.sourceType === 'project' ? 'repository' : 'entity',
          correlationId: null,
          message,
        });
        emit(
          entity.mode === 'git_only_fallback' ? 'fallback' : 'git_sync',
          'failed',
          message,
          entity.id,
        );
      }
    }

    state.status = hasHardFailures ? 'failed' : hasPartialResults ? 'partial' : 'finished';
    await notifyState();
    const completionMessage = {
      finished: 'Transfer completed',
      partial: 'Transfer completed with conflicts',
      failed: 'Transfer failed',
    }[state.status];
    emit('complete', state.status, completionMessage);
    return transferResult(state, failures, entityResults, plan);
  } catch (error) {
    if (controller.signal.aborted) {
      state.status = 'canceled';
      await notifyState();
      emit('complete', 'canceled', 'Transfer canceled');
      return transferResult(state, failures, entityResults, plan);
    }
    state.status = 'failed';
    await notifyState();
    failures.push({
      entityId: null,
      relation: 'operation',
      correlationId: null,
      message: error.message,
      ambiguous: error.ambiguous === true,
    });
    emit('complete', 'failed', 'Transfer failed');
    return transferResult(state, failures, entityResults, plan);
  } finally {
    signal?.removeEventListener('abort', abortFromCaller);
    delete destination.token;
    state.controller = null;
  }
}

export async function getTransferStatus(runId) {
  const state = activeTransfers.get(runId);
  if (!state) throw new Error(`Transfer ${runId} is not known in this process`);
  return safeRunState(state);
}

export async function cancelTransfer(runId, options = {}) {
  const state = activeTransfers.get(runId);
  if (!state) throw new Error(`Transfer ${runId} is not known in this process`);
  const terminalStatuses = ['finished', 'partial', 'failed', 'canceled'];
  if (terminalStatuses.includes(state.status)) return safeRunState(state);
  const api = options.api ?? gitLabApi;
  if (state.bulkImportId !== null) {
    await api.cancelBulkImport(state.destination, state.bulkImportId);
    if (terminalStatuses.includes(state.status)) return safeRunState(state);
  }
  state.status = 'canceled';
  state.controller.abort(new DOMException('Canceled', 'AbortError'));
  return safeRunState(state);
}
