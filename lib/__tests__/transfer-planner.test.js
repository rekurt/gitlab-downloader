import { describe, expect, test } from '@jest/globals';

import { planTransfer } from '../transfer.js';

function createApi({
  sourceVersion = '18.6.2',
  destinationVersion = '18.7.1',
  bulkImportEnabled = true,
  sourceBulkImportEnabled = bulkImportEnabled,
  destinationBulkImportEnabled = bulkImportEnabled,
  sourceGroups = {},
  destinationGroups = {},
  sourceProjects = {},
  destinationProjects = {},
  groupProjects = {},
  subgroups = {},
} = {}) {
  const allDestinationGroups = {
    archive: { id: 1, full_path: 'archive', permissions: { group_access: { access_level: 50 } } },
    ...destinationGroups,
  };
  return {
    getGitLabVersion: async (connection) => ({
      version: connection.url.includes('source') ? sourceVersion : destinationVersion,
    }),
    getCurrentUser: async () => ({ id: 1, username: 'migration-owner' }),
    getApplicationSettings: async (connection) => ({
      bulk_import_enabled: connection.url.includes('source')
        ? sourceBulkImportEnabled
        : destinationBulkImportEnabled,
    }),
    getGroup: async (connection, path) =>
      (connection.url.includes('source') ? sourceGroups[path] : allDestinationGroups[path]) ?? null,
    getProject: async (connection, path) =>
      (connection.url.includes('source') ? sourceProjects[path] : destinationProjects[path]) ?? null,
    listGroupProjects: async (_connection, path) => groupProjects[path] ?? [],
    listSubgroups: async (_connection, path) => subgroups[path] ?? [],
  };
}

function input(overrides = {}) {
  return {
    source: {
      url: 'https://source.example.com',
      token: 'source-token-that-must-not-leak',
      fullPath: 'team/platform',
      type: 'group',
    },
    destination: {
      url: 'https://destination.example.com',
      token: 'destination-token-that-must-not-leak',
      namespace: 'archive',
    },
    ...overrides,
  };
}

describe('planTransfer', () => {
  test('uses one direct transfer for a missing group subtree', async () => {
    const api = createApi({
      sourceGroups: {
        'team/platform': { id: 10, full_path: 'team/platform', path: 'platform' },
      },
    });

    const plan = await planTransfer(input(), { api, now: () => new Date('2026-08-20T10:00:00Z') });

    expect(plan.entities).toEqual([
      {
        id: 'group:team/platform',
        sourceType: 'group',
        sourceFullPath: 'team/platform',
        destinationFullPath: 'archive/platform',
        destinationNamespace: 'archive',
        destinationSlug: 'platform',
        mode: 'direct_transfer',
        reason: 'destination group does not exist',
      },
    ]);
    expect(JSON.stringify(plan)).not.toContain('token-that-must-not-leak');
  });

  test('recursively partitions existing projects and missing subgroups', async () => {
    const api = createApi({
      sourceGroups: {
        'team/platform': { id: 10, full_path: 'team/platform', path: 'platform' },
      },
      destinationGroups: {
        'archive/platform': { id: 20, full_path: 'archive/platform', path: 'platform' },
      },
      destinationProjects: {
        'archive/platform/api': { id: 200, path_with_namespace: 'archive/platform/api' },
      },
      groupProjects: {
        'team/platform': [
          { id: 100, path: 'api', path_with_namespace: 'team/platform/api' },
          { id: 101, path: 'web', path_with_namespace: 'team/platform/web' },
        ],
      },
      subgroups: {
        'team/platform': [
          { id: 11, path: 'tools', full_path: 'team/platform/tools' },
        ],
      },
    });

    const plan = await planTransfer(input(), { api });

    expect(plan.entities.map(({ sourceFullPath, destinationFullPath, mode }) => ({
      sourceFullPath,
      destinationFullPath,
      mode,
    }))).toEqual([
      {
        sourceFullPath: 'team/platform/api',
        destinationFullPath: 'archive/platform/api',
        mode: 'git_sync',
      },
      {
        sourceFullPath: 'team/platform/web',
        destinationFullPath: 'archive/platform/web',
        mode: 'direct_transfer',
      },
      {
        sourceFullPath: 'team/platform/tools',
        destinationFullPath: 'archive/platform/tools',
        mode: 'direct_transfer',
      },
    ]);
  });

  test('uses Git-only skeleton entities when versions are incompatible', async () => {
    const api = createApi({
      sourceVersion: '17.9.8',
      destinationVersion: '18.7.1',
      sourceGroups: {
        'team/platform': { id: 10, full_path: 'team/platform', path: 'platform' },
      },
      groupProjects: {
        'team/platform': [
          { id: 100, path: 'api', path_with_namespace: 'team/platform/api' },
        ],
      },
    });

    const plan = await planTransfer(input(), { api });

    expect(plan.entities.map(({ sourceType, sourceFullPath, mode }) => ({
      sourceType,
      sourceFullPath,
      mode,
    }))).toEqual([
      { sourceType: 'group', sourceFullPath: 'team/platform', mode: 'git_only_fallback' },
      { sourceType: 'project', sourceFullPath: 'team/platform/api', mode: 'git_only_fallback' },
    ]);
    expect(plan.warnings).toContain(
      'Direct Transfer is unavailable for GitLab 17.9.8 -> 18.7.1; using Git-only fallback',
    );
  });

  test('uses Git-only fallback when bulk imports are explicitly disabled', async () => {
    const api = createApi({
      bulkImportEnabled: false,
      sourceProjects: {
        'team/platform-api': {
          id: 10,
          path: 'platform-api',
          path_with_namespace: 'team/platform-api',
        },
      },
    });
    const request = input({
      source: {
        ...input().source,
        type: 'project',
        fullPath: 'team/platform-api',
      },
    });

    const plan = await planTransfer(request, { api });

    expect(plan.entities[0].mode).toBe('git_only_fallback');
    expect(plan.warnings).toContain('Direct Transfer is disabled on the destination GitLab');
  });

  test('uses Git-only fallback when bulk imports are disabled on the source', async () => {
    const api = createApi({
      sourceBulkImportEnabled: false,
      sourceProjects: {
        'team/platform-api': { id: 10, path: 'platform-api' },
      },
    });
    const request = input({
      source: { ...input().source, type: 'project', fullPath: 'team/platform-api' },
    });

    const plan = await planTransfer(request, { api });

    expect(plan.entities[0].mode).toBe('git_only_fallback');
    expect(plan.warnings).toContain('Direct Transfer is disabled on the source GitLab');
  });

  test('fails preflight when the source entity cannot be read', async () => {
    await expect(planTransfer(input(), { api: createApi() })).rejects.toThrow(
      'Source group team/platform was not found or is not readable',
    );
  });

  test('fails preflight when the token lacks Owner access to the destination namespace', async () => {
    const api = createApi({
      sourceGroups: {
        'team/platform': { id: 10, full_path: 'team/platform', path: 'platform' },
      },
      destinationGroups: {
        archive: {
          id: 1,
          full_path: 'archive',
          permissions: { group_access: { access_level: 30 } },
        },
      },
    });
    await expect(planTransfer(input(), { api })).rejects.toThrow(/Owner access/);
  });

  test('fails preflight when explicit source permissions are below Owner', async () => {
    const api = createApi({
      sourceGroups: {
        'team/platform': {
          id: 10,
          full_path: 'team/platform',
          permissions: { group_access: { access_level: 40 } },
        },
      },
    });
    await expect(planTransfer(input(), { api })).rejects.toThrow(
      /Owner access is required for source group team\/platform/,
    );
  });

  test('blocks Git modes when the local git executable is unavailable', async () => {
    const api = createApi({
      sourceProjects: {
        'team/platform-api': { id: 10, path: 'platform-api' },
      },
      destinationProjects: {
        'archive/platform-api': { id: 20, path: 'platform-api' },
      },
    });
    const request = input({
      source: { ...input().source, type: 'project', fullPath: 'team/platform-api' },
    });
    const plan = await planTransfer(request, {
      api,
      inspectTools: async () => ({ git: false, gitLfs: false, gitFilterRepo: false }),
    });

    expect(plan.entities[0]).toMatchObject({
      mode: 'blocked',
      reason: 'git is required for repository synchronization',
    });
  });

  test('fails when version or destination namespace preflight is unreadable', async () => {
    const unreadableVersion = createApi({
      sourceGroups: { 'team/platform': { id: 10, full_path: 'team/platform' } },
    });
    unreadableVersion.getGitLabVersion = async (connection) => (
      connection.url.includes('source') ? {} : { version: '18.7.1' }
    );
    await expect(planTransfer(input(), { api: unreadableVersion })).rejects.toThrow(
      'Source GitLab did not return a readable version',
    );

    const missingNamespace = createApi({
      sourceGroups: { 'team/platform': { id: 10, full_path: 'team/platform' } },
    });
    missingNamespace.getGroup = async (connection, path) => (
      connection.url.includes('source') && path === 'team/platform'
        ? { id: 10, full_path: path }
        : null
    );
    await expect(planTransfer(input(), { api: missingNamespace })).rejects.toThrow(
      'Destination namespace archive',
    );
  });

  test('continues when protected settings are unreadable and warns about unverifiable rights', async () => {
    const api = createApi({
      sourceGroups: { 'team/platform': { id: 10, full_path: 'team/platform' } },
      destinationGroups: { archive: { id: 1, full_path: 'archive' } },
    });
    api.getApplicationSettings = async () => {
      const error = new Error('forbidden');
      error.status = 403;
      throw error;
    };
    const result = await planTransfer(input(), { api });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Owner access'),
      expect.stringContaining('bulk-import setting'),
    ]));

    api.getApplicationSettings = async () => { throw new Error('offline'); };
    await expect(planTransfer(input(), { api })).rejects.toThrow('offline');
  });

  test('warns when git-lfs is unavailable but keeps a safe Git-sync executable', async () => {
    const api = createApi({
      sourceProjects: { 'team/platform-api': { id: 10, path: 'platform-api' } },
      destinationProjects: { 'archive/platform-api': { id: 20, path: 'platform-api' } },
    });
    const request = input({
      source: { ...input().source, type: 'project', fullPath: 'team/platform-api' },
    });
    const result = await planTransfer(request, {
      api,
      inspectTools: async () => ({ git: true, gitLfs: false, gitFilterRepo: true }),
    });
    expect(result.entities[0].mode).toBe('git_sync');
    expect(result.warnings).toContain(
      'git-lfs is unavailable; repositories using LFS cannot be fully synchronized',
    );
  });
});
