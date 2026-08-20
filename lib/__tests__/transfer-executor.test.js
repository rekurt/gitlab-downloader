import { describe, expect, test } from '@jest/globals';

import {
  cancelTransfer,
  executeTransfer,
  getTransferStatus,
} from '../transfer.js';

function plan(mode = 'direct_transfer') {
  return {
    schemaVersion: 1,
    createdAt: '2026-08-20T10:00:00.000Z',
    source: {
      url: 'https://source.example.com',
      version: '18.6.2',
      fullPath: 'team/platform',
      type: 'group',
    },
    destination: {
      url: 'https://destination.example.com',
      version: '18.7.1',
      namespace: 'archive',
    },
    entities: [
      {
        id: 'group:team/platform',
        sourceType: 'group',
        sourceFullPath: 'team/platform',
        destinationFullPath: 'archive/platform',
        destinationNamespace: 'archive',
        destinationSlug: 'platform',
        mode,
        reason: 'test fixture',
      },
    ],
    warnings: [],
  };
}

function credentials() {
  return {
    sourceToken: 'source-secret',
    destinationToken: 'destination-secret',
  };
}

describe('executeTransfer', () => {
  test('requires both credentials before creating run state', async () => {
    await expect(executeTransfer(plan(), {
      sourceToken: 'source-only',
      runId: 'run-missing-credentials',
    })).rejects.toThrow('Source and destination tokens');
  });

  test('polls Direct Transfer and returns relation failures without secrets', async () => {
    const statuses = ['started', 'finished'];
    const events = [];
    const api = {
      startBulkImport: async () => ({ id: 41, status: 'created' }),
      getBulkImport: async () => ({ id: 41, status: statuses.shift(), has_failures: true }),
      getBulkImportEntities: async () => [
        { id: 9, status: 'finished', has_failures: true, source_full_path: 'team/platform' },
      ],
      getBulkImportFailures: async () => [
        { relation: 'issues', correlation_id_value: 'corr-1', exception_message: 'failed row' },
      ],
      cancelBulkImport: async () => ({ id: 41, status: 'canceled' }),
    };

    const result = await executeTransfer(plan(), {
      ...credentials(),
      api,
      pollIntervalMs: 0,
      runId: 'run-1',
      onEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({
      runId: 'run-1',
      status: 'failed',
      bulkImportId: 41,
      failures: [
        {
          entityId: 9,
          relation: 'issues',
          correlationId: 'corr-1',
          message: 'failed row',
        },
      ],
    });
    expect(events.map(({ phase, status }) => ({ phase, status }))).toEqual([
      { phase: 'direct_transfer', status: 'started' },
      { phase: 'direct_transfer', status: 'running' },
      { phase: 'direct_transfer', status: 'running' },
      { phase: 'complete', status: 'failed' },
    ]);
    expect(JSON.stringify({ result, events })).not.toContain('secret');
  });

  test('runs non-direct entities through explicit handlers after a successful import', async () => {
    const calls = [];
    const transferPlan = plan();
    transferPlan.entities.push({
      ...transferPlan.entities[0],
      id: 'project:team/existing',
      sourceType: 'project',
      sourceFullPath: 'team/existing',
      destinationFullPath: 'archive/existing',
      destinationSlug: 'existing',
      mode: 'git_sync',
    });
    const api = {
      startBulkImport: async () => ({ id: 42, status: 'created' }),
      getBulkImport: async () => ({ id: 42, status: 'finished', has_failures: false }),
      getBulkImportEntities: async () => [
        { id: 10, status: 'finished', has_failures: false, source_full_path: 'team/platform' },
      ],
      getBulkImportFailures: async () => [],
    };

    const result = await executeTransfer(transferPlan, {
      ...credentials(),
      api,
      pollIntervalMs: 0,
      runId: 'run-2',
      syncRepository: async (entity) => {
        calls.push(entity.id);
        return { status: 'finished', pushed: ['refs/heads/main'], conflicts: [] };
      },
    });

    expect(result.status).toBe('finished');
    expect(calls).toEqual(['project:team/existing']);
  });

  test('reports Git synchronization conflicts as a partial transfer', async () => {
    const transferPlan = plan('git_sync');
    transferPlan.entities[0] = {
      ...transferPlan.entities[0],
      id: 'project:team/platform',
      sourceType: 'project',
    };

    const result = await executeTransfer(transferPlan, {
      ...credentials(),
      runId: 'run-partial',
      syncRepository: async () => ({
        status: 'partial',
        pushed: ['refs/heads/new'],
        conflicts: ['refs/heads/main', 'refs/tags/v1'],
      }),
    });

    expect(result.status).toBe('partial');
    expect(result.failures).toEqual([
      {
        entityId: 'project:team/platform',
        relation: 'repository',
        correlationId: null,
        message: 'Conflicting refs were left unchanged: refs/heads/main, refs/tags/v1',
      },
    ]);
    expect(result.summary).toEqual({
      supported: [],
      skipped: [],
      conflicts: [
        { entityId: 'project:team/platform', ref: 'refs/heads/main' },
        { entityId: 'project:team/platform', ref: 'refs/tags/v1' },
      ],
    });
  });

  test('resumes a known bulk import without issuing a duplicate POST', async () => {
    const api = {
      startBulkImport: async () => { throw new Error('must not start twice'); },
      getBulkImport: async () => ({ id: 77, status: 'finished', has_failures: false }),
      getBulkImportEntities: async () => [
        { id: 8, status: 'finished', has_failures: false, source_full_path: 'team/platform' },
      ],
      getBulkImportFailures: async () => [],
    };
    const result = await executeTransfer(plan(), {
      ...credentials(),
      api,
      runId: 'run-resume',
      resumeBulkImportId: 77,
      pollIntervalMs: 0,
    });
    expect(result).toMatchObject({ status: 'finished', bulkImportId: 77 });
    expect(result.summary.supported).toEqual(['team/platform']);
  });

  test('returns a canceled Direct Transfer without reading entity results', async () => {
    const api = {
      startBulkImport: async () => ({ id: 88 }),
      getBulkImport: async () => ({ id: 88, status: 'canceled' }),
      getBulkImportEntities: async () => { throw new Error('must not read entities'); },
    };
    await expect(executeTransfer(plan(), {
      ...credentials(), api, runId: 'run-remote-canceled', pollIntervalMs: 0,
    })).resolves.toMatchObject({ status: 'canceled', bulkImportId: 88 });
  });

  test('does not report success when a Direct Transfer entity itself failed', async () => {
    const api = {
      startBulkImport: async () => ({ id: 89 }),
      getBulkImport: async () => ({ id: 89, status: 'finished', has_failures: false }),
      getBulkImportEntities: async () => [{
        id: 12,
        source_full_path: 'team/platform',
        status: 'failed',
        has_failures: false,
      }],
      getBulkImportFailures: async () => [],
    };
    await expect(executeTransfer(plan(), {
      ...credentials(), api, runId: 'run-entity-failed', pollIntervalMs: 0,
    })).resolves.toMatchObject({
      status: 'failed',
      entities: [expect.objectContaining({ id: 12, status: 'failed' })],
    });
  });

  test('does not report success when GitLab omits a planned Direct Transfer entity', async () => {
    const api = {
      startBulkImport: async () => ({ id: 91 }),
      getBulkImport: async () => ({ id: 91, status: 'finished', has_failures: false }),
      getBulkImportEntities: async () => [],
      getBulkImportFailures: async () => [],
    };
    await expect(executeTransfer(plan(), {
      ...credentials(), api, runId: 'run-direct-missing-entity', pollIntervalMs: 0,
    })).resolves.toMatchObject({
      status: 'failed',
      failures: [expect.objectContaining({
        entityId: 'group:team/platform',
        message: expect.stringContaining('did not return a terminal result'),
      })],
    });
  });

  test('does not report success while a Direct Transfer entity is non-terminal', async () => {
    const api = {
      startBulkImport: async () => ({ id: 92 }),
      getBulkImport: async () => ({ id: 92, status: 'finished', has_failures: false }),
      getBulkImportEntities: async () => [{
        id: 13,
        source_full_path: 'team/platform',
        status: 'started',
        has_failures: false,
      }],
      getBulkImportFailures: async () => [],
    };
    await expect(executeTransfer(plan(), {
      ...credentials(), api, runId: 'run-direct-non-terminal', pollIntervalMs: 0,
    })).resolves.toMatchObject({
      status: 'failed',
      failures: [expect.objectContaining({
        entityId: 13,
        message: 'Direct Transfer entity ended as started',
      })],
    });
  });

  test('treats a timed-out Direct Transfer as terminal failure', async () => {
    const api = {
      startBulkImport: async () => ({ id: 90 }),
      getBulkImport: async () => ({ id: 90, status: 'timeout', has_failures: false }),
      getBulkImportEntities: async () => [],
      getBulkImportFailures: async () => [],
    };
    await expect(executeTransfer(plan(), {
      ...credentials(), api, runId: 'run-direct-timeout', pollIntervalMs: 0,
    })).resolves.toMatchObject({ status: 'failed', bulkImportId: 90 });
  });

  test('reports blocked, fallback, failed, and LFS-partial entity outcomes', async () => {
    const transferPlan = plan('blocked');
    transferPlan.entities.push(
      {
        ...transferPlan.entities[0],
        id: 'group:team/new',
        sourceFullPath: 'team/new',
        destinationFullPath: 'archive/new',
        destinationSlug: 'new',
        mode: 'git_only_fallback',
      },
      {
        ...transferPlan.entities[0],
        id: 'project:team/failed',
        sourceType: 'project',
        sourceFullPath: 'team/failed',
        destinationFullPath: 'archive/failed',
        destinationSlug: 'failed',
        mode: 'git_sync',
      },
    );
    const fallback = [];
    const result = await executeTransfer(transferPlan, {
      ...credentials(),
      runId: 'run-mixed-results',
      ensureFallbackEntity: async (entity) => fallback.push(entity.id),
      syncRepository: async () => ({ status: 'failed' }),
    });
    expect(result.status).toBe('failed');
    expect(fallback).toEqual(['group:team/new']);
    expect(result.summary.skipped).toEqual(['group:team/platform']);
    expect(result.summary.supported).toContain('team/new');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: 'group:team/platform', relation: 'entity' }),
      expect.objectContaining({ entityId: 'project:team/failed', message: 'Git synchronization failed' }),
    ]));

    const partialPlan = plan('git_sync');
    partialPlan.entities[0].sourceType = 'project';
    const partial = await executeTransfer(partialPlan, {
      ...credentials(),
      runId: 'run-lfs-partial',
      syncRepository: async () => ({ status: 'partial', lfs: { message: 'LFS push failed' } }),
    });
    expect(partial).toMatchObject({
      status: 'partial',
      failures: [expect.objectContaining({ message: 'LFS push failed' })],
    });
  });

  test('records a thrown entity failure and continues with independent repositories', async () => {
    const transferPlan = plan('git_sync');
    transferPlan.entities[0] = {
      ...transferPlan.entities[0],
      id: 'project:team/first',
      sourceType: 'project',
      sourceFullPath: 'team/first',
    };
    transferPlan.entities.push({
      ...transferPlan.entities[0],
      id: 'project:team/second',
      sourceFullPath: 'team/second',
      destinationFullPath: 'archive/second',
      destinationSlug: 'second',
    });
    const calls = [];
    const result = await executeTransfer(transferPlan, {
      ...credentials(),
      runId: 'run-continue-after-entity-failure',
      syncRepository: async (entity) => {
        calls.push(entity.id);
        if (entity.id.endsWith('first')) throw new Error('first repository failed');
        return { status: 'finished', conflicts: [] };
      },
    });

    expect(calls).toEqual(['project:team/first', 'project:team/second']);
    expect(result).toMatchObject({
      status: 'failed',
      entities: [
        expect.objectContaining({ id: 'project:team/first', status: 'failed' }),
        expect.objectContaining({ id: 'project:team/second', status: 'finished' }),
      ],
    });
    expect(result.summary.supported).toContain('team/second');
  });

  test('records ambiguous start failures and handler configuration errors', async () => {
    const ambiguous = new Error('POST outcome is unknown');
    ambiguous.ambiguous = true;
    const result = await executeTransfer(plan(), {
      ...credentials(),
      runId: 'run-ambiguous-post',
      api: { startBulkImport: async () => { throw ambiguous; } },
    });
    expect(result).toMatchObject({
      status: 'failed',
      failures: [expect.objectContaining({ ambiguous: true, message: 'POST outcome is unknown' })],
    });

    const fallbackResult = await executeTransfer(plan('git_only_fallback'), {
      ...credentials(),
      runId: 'run-no-fallback-handler',
      ensureFallbackEntity: null,
    });
    expect(fallbackResult).toMatchObject({ status: 'failed' });
    expect(fallbackResult.failures[0].message).toContain('fallback handler');

    const syncPlan = plan('git_sync');
    syncPlan.entities[0].sourceType = 'project';
    const syncResult = await executeTransfer(syncPlan, {
      ...credentials(),
      runId: 'run-no-sync-handler',
      syncRepository: null,
    });
    expect(syncResult.failures[0].message).toContain('synchronization handler');
  });

  test('honors a caller signal that is already canceled', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Canceled', 'AbortError'));
    const syncPlan = plan('git_sync');
    syncPlan.entities[0].sourceType = 'project';
    const result = await executeTransfer(syncPlan, {
      ...credentials(),
      runId: 'run-pre-canceled',
      signal: controller.signal,
      syncRepository: async (_entity, { signal }) => { throw signal.reason; },
    });
    expect(result.status).toBe('canceled');
  });
});

describe('transfer operation registry', () => {
  test('removes the destination credential from retained terminal state', async () => {
    let capturedDestination;
    const api = {
      startBulkImport: async (destination) => {
        capturedDestination = destination;
        return { id: 54, status: 'created' };
      },
      getBulkImport: async () => ({ id: 54, status: 'finished', has_failures: false }),
      getBulkImportEntities: async () => [{
        id: 7,
        source_full_path: 'team/platform',
        status: 'finished',
        has_failures: false,
      }],
      getBulkImportFailures: async () => [],
    };

    await executeTransfer(plan(), {
      ...credentials(), api, runId: 'run-terminal-credential-cleanup', pollIntervalMs: 0,
    });

    expect(capturedDestination).toEqual({ url: 'https://destination.example.com' });
    await expect(getTransferStatus('run-terminal-credential-cleanup'))
      .resolves.toMatchObject({ status: 'finished' });
  });

  test('reports and cancels an active run independently', async () => {
    let releasePoll;
    const pollGate = new Promise((resolve) => {
      releasePoll = resolve;
    });
    const canceled = [];
    const api = {
      startBulkImport: async () => ({ id: 55, status: 'created' }),
      getBulkImport: async (_destination, _id, { signal }) => {
        await Promise.race([
          pollGate,
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
        ]);
        return { id: 55, status: 'started', has_failures: false };
      },
      cancelBulkImport: async (_destination, id) => {
        canceled.push(id);
        return { id, status: 'canceled' };
      },
      getBulkImportEntities: async () => [],
      getBulkImportFailures: async () => [],
    };

    const execution = executeTransfer(plan(), {
      ...credentials(),
      api,
      pollIntervalMs: 0,
      runId: 'run-cancel',
    });
    await new Promise((resolve) => setImmediate(resolve));

    await expect(getTransferStatus('run-cancel', { api })).resolves.toMatchObject({
      runId: 'run-cancel',
      status: 'running',
      bulkImportId: 55,
    });
    await expect(cancelTransfer('run-cancel', { api })).resolves.toMatchObject({
      status: 'canceled',
    });
    await expect(execution).resolves.toMatchObject({ status: 'canceled' });
    expect(canceled).toEqual([55]);
    releasePoll();
  });

  test('preserves a terminal result when execution finishes during remote cancellation', async () => {
    let releasePoll;
    let releaseCancel;
    let markPollStarted;
    let markCancelStarted;
    const pollGate = new Promise((resolve) => { releasePoll = resolve; });
    const cancelGate = new Promise((resolve) => { releaseCancel = resolve; });
    const pollStarted = new Promise((resolve) => { markPollStarted = resolve; });
    const cancelStarted = new Promise((resolve) => { markCancelStarted = resolve; });
    const api = {
      startBulkImport: async () => ({ id: 56, status: 'created' }),
      getBulkImport: async () => {
        markPollStarted();
        await pollGate;
        return { id: 56, status: 'finished', has_failures: false };
      },
      getBulkImportEntities: async () => [{
        id: 8,
        source_full_path: 'team/platform',
        status: 'finished',
        has_failures: false,
      }],
      getBulkImportFailures: async () => [],
      cancelBulkImport: async () => {
        markCancelStarted();
        await cancelGate;
        return { id: 56, status: 'canceled' };
      },
    };

    const execution = executeTransfer(plan(), {
      ...credentials(), api, runId: 'run-cancel-finish-race', pollIntervalMs: 0,
    });
    await pollStarted;
    const cancellation = cancelTransfer('run-cancel-finish-race', { api });
    await cancelStarted;
    releasePoll();
    await expect(execution).resolves.toMatchObject({ status: 'finished' });
    releaseCancel();

    await expect(cancellation).resolves.toMatchObject({ status: 'finished' });
    await expect(getTransferStatus('run-cancel-finish-race'))
      .resolves.toMatchObject({ status: 'finished' });
  });

  test('rejects unknown runs and leaves completed runs unchanged', async () => {
    await expect(getTransferStatus('unknown-run')).rejects.toThrow('not known');
    await expect(cancelTransfer('unknown-run')).rejects.toThrow('not known');

    const syncPlan = plan('git_sync');
    syncPlan.entities[0].sourceType = 'project';
    await executeTransfer(syncPlan, {
      ...credentials(),
      runId: 'run-completed-status',
      syncRepository: async () => ({ status: 'finished' }),
    });
    await expect(cancelTransfer('run-completed-status')).resolves.toMatchObject({ status: 'finished' });
    await expect(executeTransfer(syncPlan, {
      ...credentials(),
      runId: 'run-completed-status',
      syncRepository: async () => ({ status: 'finished' }),
    })).rejects.toThrow('already exists');
  });
});
