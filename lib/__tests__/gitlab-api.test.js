import { afterEach, describe, expect, test } from '@jest/globals';
import { createServer } from 'node:http';

import {
  GitLabApiError,
  cancelBulkImport,
  createGroup,
  createProject,
  getBulkImport,
  getBulkImportEntities,
  getBulkImportFailures,
  getProject,
  listGroupProjects,
  listSubgroups,
  requestGitLab,
  startBulkImport,
} from '../gitlab-api.js';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function startServer(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function connection(url) {
  return { url, token: 'source-secret' };
}

describe('requestGitLab', () => {
  test('sends PAT in a header and never in the URL', async () => {
    let observed;
    const url = await startServer((request, response) => {
      observed = { url: request.url, token: request.headers['private-token'] };
      json(response, 200, { id: 7 });
    });

    await expect(requestGitLab(connection(url), '/user')).resolves.toEqual({ id: 7 });
    expect(observed).toEqual({ url: '/api/v4/user', token: 'source-secret' });
  });

  test('retries an idempotent GET after a server failure', async () => {
    let requests = 0;
    const url = await startServer((_request, response) => {
      requests += 1;
      if (requests === 1) return json(response, 503, { message: 'busy' });
      return json(response, 200, { ok: true });
    });

    await expect(
      requestGitLab(connection(url), '/version', { retryDelayMs: 1 }),
    ).resolves.toEqual({ ok: true });
    expect(requests).toBe(2);
  });

  test('marks a failed POST as ambiguous and does not retry it', async () => {
    let requests = 0;
    const url = await startServer((_request, response) => {
      requests += 1;
      response.destroy();
    });

    await expect(
      requestGitLab(connection(url), '/bulk_imports', {
        method: 'POST',
        body: { entities: [] },
        retryDelayMs: 1,
      }),
    ).rejects.toMatchObject({ ambiguous: true });
    expect(requests).toBe(1);
  });

  test('returns null for an allowed 404', async () => {
    const url = await startServer((_request, response) => {
      json(response, 404, { message: '404 Project Not Found' });
    });

    await expect(getProject(connection(url), 'group/missing')).resolves.toBeNull();
  });

  test('throws a structured API error for a non-retriable response', async () => {
    const url = await startServer((_request, response) => {
      json(response, 403, { message: 'Forbidden' });
    });

    await expect(requestGitLab(connection(url), '/user')).rejects.toBeInstanceOf(GitLabApiError);
    await expect(requestGitLab(connection(url), '/user')).rejects.toMatchObject({ status: 403 });
  });

  test('retries 429 with Retry-After and parses non-JSON error bodies', async () => {
    let requests = 0;
    const url = await startServer((_request, response) => {
      requests += 1;
      if (requests === 1) return json(response, 429, { message: 'rate limited' }, { 'retry-after': '0' });
      response.writeHead(401, { 'content-type': 'text/plain' });
      response.end('unauthorized text');
    });
    await expect(requestGitLab(connection(url), '/user', {
      maxAttempts: 2,
      retryDelayMs: 1,
    })).rejects.toMatchObject({ status: 401, responseBody: 'unauthorized text' });
    expect(requests).toBe(2);
  });

  test('honors caller cancellation and request timeout', async () => {
    const pendingFetch = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
    await expect(requestGitLab(connection('https://gitlab.example.com'), '/version', {
      fetchFn: pendingFetch,
      timeoutMs: 5,
      maxAttempts: 1,
    })).rejects.toBeInstanceOf(GitLabApiError);

    const controller = new AbortController();
    const pending = requestGitLab(connection('https://gitlab.example.com'), '/version', {
      fetchFn: pendingFetch,
      signal: controller.signal,
      maxAttempts: 1,
    });
    controller.abort(new DOMException('Canceled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('returns response metadata for an allowed 404', async () => {
    const url = await startServer((_request, response) => json(response, 404, { message: 'missing' }));
    const result = await requestGitLab(connection(url), '/groups/missing', {
      allowNotFound: true,
      returnResponse: true,
    });
    expect(result.data).toBeNull();
    expect(result.response.status).toBe(404);
  });
});

describe('GitLab transfer endpoints', () => {
  test('creates Git-only group and project skeletons in an explicit namespace', async () => {
    const observed = [];
    const url = await startServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      observed.push({ method: request.method, url: request.url, body: JSON.parse(raw) });
      if (request.url === '/api/v4/groups') return json(response, 201, { id: 71, full_path: 'archive/tools' });
      return json(response, 201, { id: 72, path_with_namespace: 'archive/tools/api' });
    });

    await expect(createGroup(connection(url), {
      name: 'tools',
      path: 'tools',
      parentId: 50,
    })).resolves.toMatchObject({ id: 71 });
    await expect(createProject(connection(url), {
      name: 'api',
      path: 'api',
      namespaceId: 71,
    })).resolves.toMatchObject({ id: 72 });

    expect(observed).toEqual([
      {
        method: 'POST',
        url: '/api/v4/groups',
        body: { name: 'tools', path: 'tools', parent_id: 50, visibility: 'private' },
      },
      {
        method: 'POST',
        url: '/api/v4/projects',
        body: { name: 'api', path: 'api', namespace_id: 71, visibility: 'private' },
      },
    ]);
  });

  test('follows X-Next-Page pagination for direct group projects', async () => {
    const url = await startServer((request, response) => {
      const page = new URL(request.url, url).searchParams.get('page');
      if (page === '1') {
        return json(response, 200, [{ id: 1, path_with_namespace: 'team/one' }], {
          'x-next-page': '2',
        });
      }
      return json(response, 200, [{ id: 2, path_with_namespace: 'team/two' }]);
    });

    await expect(listGroupProjects(connection(url), 'team')).resolves.toEqual([
      { id: 1, path_with_namespace: 'team/one' },
      { id: 2, path_with_namespace: 'team/two' },
    ]);
  });

  test('rejects malformed paginated API contracts', async () => {
    const url = await startServer((_request, response) => json(response, 200, { not: 'an array' }));
    await expect(listSubgroups(connection(url), 'team')).rejects.toThrow('non-array page');
  });

  test('starts, reads failures, and cancels a bulk import', async () => {
    const observed = [];
    const url = await startServer(async (request, response) => {
      const pathname = new URL(request.url, url).pathname;
      let raw = '';
      for await (const chunk of request) raw += chunk;
      observed.push({ method: request.method, url: request.url, body: raw ? JSON.parse(raw) : null });

      if (request.method === 'POST' && request.url === '/api/v4/bulk_imports') {
        return json(response, 201, { id: 41, status: 'created' });
      }
      if (pathname === '/api/v4/bulk_imports/41/entities') {
        return json(response, 200, [{ id: 9, status: 'failed', has_failures: true }]);
      }
      if (pathname === '/api/v4/bulk_imports/41/entities/9/failures') {
        return json(response, 200, [{ relation: 'issues', correlation_id_value: 'corr-1' }]);
      }
      if (request.method === 'POST' && request.url === '/api/v4/bulk_imports/41/cancel') {
        return json(response, 200, { id: 41, status: 'canceled' });
      }
      return json(response, 200, { id: 41, status: 'started' });
    });

    const source = { url: 'https://source.example.com', token: 'source-secret' };
    const destination = connection(url);
    const entity = {
      sourceType: 'group',
      sourceFullPath: 'team/platform',
      destinationNamespace: 'archive',
      destinationSlug: 'platform',
    };

    await expect(startBulkImport(destination, source, [entity])).resolves.toEqual({
      id: 41,
      status: 'created',
    });
    await expect(getBulkImport(destination, 41)).resolves.toMatchObject({ status: 'started' });
    await expect(getBulkImportEntities(destination, 41)).resolves.toHaveLength(1);
    await expect(getBulkImportFailures(destination, 41, 9)).resolves.toEqual([
      { relation: 'issues', correlation_id_value: 'corr-1' },
    ]);
    await expect(cancelBulkImport(destination, 41)).resolves.toMatchObject({ status: 'canceled' });

    expect(observed[0]).toEqual({
      method: 'POST',
      url: '/api/v4/bulk_imports',
      body: {
        configuration: {
          url: 'https://source.example.com',
          access_token: 'source-secret',
        },
        entities: [
          {
            source_type: 'group_entity',
            source_full_path: 'team/platform',
            destination_namespace: 'archive',
            destination_slug: 'platform',
            migrate_memberships: true,
            migrate_projects: true,
          },
        ],
      },
    });
  });
});
