import { describe, expect, test } from '@jest/globals';

import { ensureGitOnlyEntity } from '../transfer.js';

describe('ensureGitOnlyEntity', () => {
  test('creates a missing group below an existing parent', async () => {
    const calls = [];
    const api = {
      getGroup: async (_connection, path) => {
        calls.push(['getGroup', path]);
        if (path === 'archive') return { id: 10, full_path: 'archive' };
        return null;
      },
      createGroup: async (_connection, input) => {
        calls.push(['createGroup', input]);
        return { id: 11, full_path: 'archive/platform' };
      },
    };

    await expect(ensureGitOnlyEntity({
      sourceType: 'group',
      destinationFullPath: 'archive/platform',
      destinationNamespace: 'archive',
      destinationSlug: 'platform',
    }, {
      destination: { url: 'https://destination.example.com', token: 'secret' },
      api,
    })).resolves.toMatchObject({ id: 11 });

    expect(calls).toEqual([
      ['getGroup', 'archive/platform'],
      ['getGroup', 'archive'],
      ['createGroup', { name: 'platform', path: 'platform', parentId: 10 }],
    ]);
  });

  test('creates a missing project in the resolved destination namespace', async () => {
    const api = {
      getProject: async () => null,
      getGroup: async () => ({ id: 20, full_path: 'archive/platform' }),
      createProject: async (_connection, input) => ({ id: 21, ...input }),
    };
    await expect(ensureGitOnlyEntity({
      sourceType: 'project',
      destinationFullPath: 'archive/platform/api',
      destinationNamespace: 'archive/platform',
      destinationSlug: 'api',
    }, {
      destination: { url: 'https://destination.example.com', token: 'secret' },
      api,
    })).resolves.toMatchObject({ id: 21, namespaceId: 20, path: 'api' });
  });

  test('does not mutate an entity that appeared concurrently', async () => {
    let creates = 0;
    const existing = { id: 30, path_with_namespace: 'archive/platform/api' };
    const api = {
      getProject: async () => existing,
      createProject: async () => { creates += 1; },
    };
    await expect(ensureGitOnlyEntity({
      sourceType: 'project',
      destinationFullPath: 'archive/platform/api',
      destinationNamespace: 'archive/platform',
      destinationSlug: 'api',
    }, {
      destination: { url: 'https://destination.example.com', token: 'secret' },
      api,
    })).resolves.toBe(existing);
    expect(creates).toBe(0);
  });

  test('refuses to create an entity below a missing or unwritable namespace', async () => {
    const api = {
      getProject: async () => null,
      getGroup: async () => null,
    };
    await expect(ensureGitOnlyEntity({
      sourceType: 'project',
      destinationFullPath: 'archive/platform/api',
      destinationNamespace: 'archive/platform',
      destinationSlug: 'api',
    }, {
      destination: { url: 'https://destination.example.com', token: 'secret' },
      api,
    })).rejects.toThrow('does not exist or is not writable');
  });
});
