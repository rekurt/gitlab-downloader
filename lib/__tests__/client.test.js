import { jest } from '@jest/globals';
import {
  maybeRateLimitDelay,
  fetchJson,
  fetchPaginated,
  fetchGroupMetadata,
  getAllProjects,
  getUserProjects,
} from '../client.js';

// Helper to create a mock fetch response
function mockResponse(body, { status = 200, headers = {} } = {}) {
  const headersObj = new Headers(headers);
  return {
    status,
    headers: headersObj,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// Default test config
function testConfig(overrides = {}) {
  return {
    url: 'https://gitlab.example.com',
    token: 'test-token',
    group: 'my-group',
    perPage: 100,
    requestTimeout: 5,
    maxRetries: 3,
    ...overrides,
  };
}

// Suppress console output in tests
const noopLogger = () => {};

describe('maybeRateLimitDelay', () => {
  it('returns 0 when headers are missing', () => {
    expect(maybeRateLimitDelay(new Headers())).toBe(0);
  });

  it('returns 0 when remaining >= 10', () => {
    const headers = new Headers({
      'RateLimit-Remaining': '50',
      'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
    });
    expect(maybeRateLimitDelay(headers)).toBe(0);
  });

  it('returns delay when remaining < 10', () => {
    const resetAt = Math.floor(Date.now() / 1000) + 15;
    const headers = new Headers({
      'RateLimit-Remaining': '3',
      'RateLimit-Reset': String(resetAt),
    });
    const delay = maybeRateLimitDelay(headers);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(30);
  });

  it('caps delay at 30 seconds', () => {
    const resetAt = Math.floor(Date.now() / 1000) + 999;
    const headers = new Headers({
      'RateLimit-Remaining': '1',
      'RateLimit-Reset': String(resetAt),
    });
    expect(maybeRateLimitDelay(headers)).toBe(30);
  });

  it('returns at least 1 second when reset is in the past', () => {
    const resetAt = Math.floor(Date.now() / 1000) - 10;
    const headers = new Headers({
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(resetAt),
    });
    expect(maybeRateLimitDelay(headers)).toBe(1);
  });

  it('returns 0 for invalid header values', () => {
    const headers = new Headers({
      'RateLimit-Remaining': 'abc',
      'RateLimit-Reset': 'xyz',
    });
    expect(maybeRateLimitDelay(headers)).toBe(0);
  });

  it('works with plain object headers', () => {
    const headers = {
      'RateLimit-Remaining': '2',
      'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 10),
    };
    const delay = maybeRateLimitDelay(headers);
    expect(delay).toBeGreaterThan(0);
  });
});

describe('fetchJson', () => {
  it('fetches JSON successfully', async () => {
    const data = { id: 1, name: 'test' };
    const mockFetch = jest.fn().mockResolvedValue(mockResponse(data));
    const config = testConfig();

    const result = await fetchJson(
      'https://gitlab.example.com/api/v4/test',
      { foo: 'bar' },
      'test resource',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('foo=bar');
  });

  it('sends Authorization Bearer header when token is provided', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse({}));
    const config = testConfig({ token: 'my-secret-token' });

    await fetchJson('https://gitlab.example.com/api/v4/test', {}, 'test', config, {
      fetchFn: mockFetch,
      logger: noopLogger,
    });

    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders['Authorization']).toBe('Bearer my-secret-token');
  });

  it('does not send Authorization header when token is null', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse({}));
    const config = testConfig({ token: null });

    await fetchJson('https://gitlab.example.com/api/v4/test', {}, 'test', config, {
      fetchFn: mockFetch,
      logger: noopLogger,
    });

    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders['Authorization']).toBeUndefined();
  });

  it('returns null on 4xx errors (non-429)', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse('Not Found', { status: 404 }));
    const config = testConfig();

    const result = await fetchJson(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 status', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(mockResponse('Rate Limited', { status: 429 }))
      .mockResolvedValueOnce(mockResponse({ success: true }));

    const config = testConfig({ maxRetries: 3 });

    const result = await fetchJson(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx status', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(mockResponse('Server Error', { status: 500 }))
      .mockResolvedValueOnce(mockResponse('Bad Gateway', { status: 502 }))
      .mockResolvedValueOnce(mockResponse({ ok: true }));

    const config = testConfig({ maxRetries: 3 });

    const result = await fetchJson(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns null after exhausting retries', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse('Error', { status: 500 }));
    const config = testConfig({ maxRetries: 2 });

    const result = await fetchJson(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors', async () => {
    const mockFetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(mockResponse({ recovered: true }));

    const config = testConfig({ maxRetries: 3 });

    const result = await fetchJson(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual({ recovered: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects Retry-After header', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(
        mockResponse('Throttled', { status: 429, headers: { 'Retry-After': '0.01' } }),
      )
      .mockResolvedValueOnce(mockResponse({ ok: true }));

    const config = testConfig({ maxRetries: 3 });

    const result = await fetchJson(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual({ ok: true });
  });

  it('handles rate limit delay on success response', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 1;
    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse({ data: true }, {
        headers: {
          'RateLimit-Remaining': '2',
          'RateLimit-Reset': String(resetAt),
        },
      }),
    );

    const config = testConfig();

    const result = await fetchJson(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual({ data: true });
  });

  it('throws on abort signal from caller', async () => {
    const abortController = new AbortController();
    abortController.abort();

    const mockFetch = jest.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const config = testConfig();

    await expect(
      fetchJson(
        'https://gitlab.example.com/api/v4/test',
        {},
        'test',
        config,
        { fetchFn: mockFetch, signal: abortController.signal, logger: noopLogger },
      ),
    ).rejects.toThrow();
  });

  it('retries on timeout (internal AbortController)', async () => {
    const timeoutError = new DOMException('Timeout', 'TimeoutError');
    const mockFetch = jest
      .fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(mockResponse({ ok: true }));

    const config = testConfig({ maxRetries: 3, requestTimeout: 1 });

    const result = await fetchJson(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('fetchPaginated', () => {
  it('fetches single page of results', async () => {
    const items = [{ id: 1 }, { id: 2 }];
    const mockFetch = jest.fn().mockResolvedValue(mockResponse(items));
    const config = testConfig({ perPage: 100 });

    const result = await fetchPaginated(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test items',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual(items);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fetches multiple pages', async () => {
    const page1 = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const page2 = [{ id: 5 }, { id: 6 }];

    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(mockResponse(page1))
      .mockResolvedValueOnce(mockResponse(page2));

    const config = testConfig({ perPage: 5 });

    const result = await fetchPaginated(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test items',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual([...page1, ...page2]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops on empty page', async () => {
    const page1 = Array.from({ length: 5 }, (_, i) => ({ id: i }));

    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(mockResponse(page1))
      .mockResolvedValueOnce(mockResponse([]));

    const config = testConfig({ perPage: 5 });

    const result = await fetchPaginated(
      'https://gitlab.example.com/api/v4/test',
      {},
      'test items',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    expect(result).toEqual(page1);
  });

  it('throws on null response (error)', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse('Error', { status: 404 }));
    const config = testConfig();

    await expect(
      fetchPaginated(
        'https://gitlab.example.com/api/v4/test',
        {},
        'test items',
        config,
        { fetchFn: mockFetch, logger: noopLogger },
      )
    ).rejects.toThrow('Failed to fetch test items at page 1');
  });

  it('throws on non-array response', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse({ error: 'unexpected' }));
    const config = testConfig();

    await expect(
      fetchPaginated(
        'https://gitlab.example.com/api/v4/test',
        {},
        'test items',
        config,
        { fetchFn: mockFetch, logger: noopLogger },
      )
    ).rejects.toThrow('Unexpected payload for test items at page 1');
  });

  it('passes per_page and page params', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse([]));
    const config = testConfig({ perPage: 50 });

    await fetchPaginated(
      'https://gitlab.example.com/api/v4/test',
      { membership: 'true' },
      'test',
      config,
      { fetchFn: mockFetch, logger: noopLogger },
    );

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('per_page=50');
    expect(calledUrl).toContain('page=1');
    expect(calledUrl).toContain('membership=true');
  });
});

describe('fetchGroupMetadata', () => {
  it('fetches group metadata successfully', async () => {
    const groupData = { id: 123, full_path: 'my-group', name: 'My Group' };
    const mockFetch = jest.fn().mockResolvedValue(mockResponse(groupData));
    const config = testConfig({ group: 'my-group' });

    const result = await fetchGroupMetadata(config, { fetchFn: mockFetch, logger: noopLogger });

    expect(result).toEqual(groupData);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/v4/groups/my-group');
  });

  it('URL-encodes group path with slashes', async () => {
    const groupData = { id: 456, full_path: 'parent/child' };
    const mockFetch = jest.fn().mockResolvedValue(mockResponse(groupData));
    const config = testConfig({ group: 'parent/child' });

    await fetchGroupMetadata(config, { fetchFn: mockFetch, logger: noopLogger });

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/v4/groups/parent%2Fchild');
  });

  it('throws when group is not set', async () => {
    const config = testConfig({ group: null });

    await expect(fetchGroupMetadata(config, { logger: noopLogger })).rejects.toThrow(
      'Group is not set',
    );
  });

  it('throws when API returns null', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse('Not Found', { status: 404 }));
    const config = testConfig({ group: 'my-group' });

    await expect(
      fetchGroupMetadata(config, { fetchFn: mockFetch, logger: noopLogger }),
    ).rejects.toThrow('Unable to fetch group metadata');
  });

  it('throws when API returns array instead of object', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse([]));
    const config = testConfig({ group: 'my-group' });

    await expect(
      fetchGroupMetadata(config, { fetchFn: mockFetch, logger: noopLogger }),
    ).rejects.toThrow('Unable to fetch group metadata');
  });
});

describe('getAllProjects', () => {
  it('returns empty array when group is not set', async () => {
    const config = testConfig({ group: null });
    const result = await getAllProjects(config, '', { logger: noopLogger });
    expect(result).toEqual([]);
  });

  it('fetches projects from a single group', async () => {
    const projects = [
      { id: 1, path_with_namespace: 'my-group/project-a' },
      { id: 2, path_with_namespace: 'my-group/project-b' },
    ];
    const noSubgroups = [];

    const mockFetch = jest
      .fn()
      // Projects for root group
      .mockResolvedValueOnce(mockResponse(projects))
      // Subgroups for root group
      .mockResolvedValueOnce(mockResponse(noSubgroups));

    const config = testConfig({ group: '123' });

    const result = await getAllProjects(config, 'my-group', {
      fetchFn: mockFetch,
      logger: noopLogger,
    });

    expect(result).toHaveLength(2);
    expect(result[0].group_path).toBe('');
    expect(result[1].group_path).toBe('');
  });

  it('recursively traverses subgroups', async () => {
    const rootProjects = [{ id: 1, path_with_namespace: 'root-group/project-a' }];
    const subgroupList = [{ id: 456, full_path: 'root-group/sub1' }];
    const subProjects = [{ id: 2, path_with_namespace: 'root-group/sub1/project-b' }];
    const noSubgroups = [];

    const mockFetch = jest
      .fn()
      // Root group projects
      .mockResolvedValueOnce(mockResponse(rootProjects))
      // Root group subgroups
      .mockResolvedValueOnce(mockResponse(subgroupList))
      // Sub1 projects
      .mockResolvedValueOnce(mockResponse(subProjects))
      // Sub1 subgroups
      .mockResolvedValueOnce(mockResponse(noSubgroups));

    const config = testConfig({ group: '100' });

    const result = await getAllProjects(config, 'root-group', {
      fetchFn: mockFetch,
      logger: noopLogger,
    });

    expect(result).toHaveLength(2);
    expect(result[0].group_path).toBe('');
    expect(result[1].group_path).toBe('sub1');
  });

  it('handles nested subgroups (3 levels)', async () => {
    const mockFetch = jest
      .fn()
      // Level 1: root projects
      .mockResolvedValueOnce(mockResponse([]))
      // Level 1: subgroups
      .mockResolvedValueOnce(mockResponse([{ id: 2, full_path: 'root/level1' }]))
      // Level 2: projects
      .mockResolvedValueOnce(mockResponse([]))
      // Level 2: subgroups
      .mockResolvedValueOnce(mockResponse([{ id: 3, full_path: 'root/level1/level2' }]))
      // Level 3: projects
      .mockResolvedValueOnce(
        mockResponse([{ id: 10, path_with_namespace: 'root/level1/level2/project' }]),
      )
      // Level 3: subgroups
      .mockResolvedValueOnce(mockResponse([]));

    const config = testConfig({ group: '1' });

    const result = await getAllProjects(config, 'root', {
      fetchFn: mockFetch,
      logger: noopLogger,
    });

    expect(result).toHaveLength(1);
    expect(result[0].group_path).toBe('level1/level2');
  });

  it('URL-encodes group IDs that contain slashes', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(mockResponse([]))
      .mockResolvedValueOnce(mockResponse([]));

    const config = testConfig({ group: 'parent/child' });

    await getAllProjects(config, 'parent/child', { fetchFn: mockFetch, logger: noopLogger });

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('parent%2Fchild');
  });
});

describe('getUserProjects', () => {
  it('fetches user projects with membership param', async () => {
    const projects = [
      { id: 1, path_with_namespace: 'group-a/project-1' },
      { id: 2, path_with_namespace: 'group-b/subgroup/project-2' },
      { id: 3, path_with_namespace: 'personal-project' },
    ];

    const mockFetch = jest.fn().mockResolvedValue(mockResponse(projects));
    const config = testConfig();

    const result = await getUserProjects(config, { fetchFn: mockFetch, logger: noopLogger });

    expect(result).toHaveLength(3);
    expect(result[0].group_path).toBe('group-a');
    expect(result[1].group_path).toBe('group-b/subgroup');
    expect(result[2].group_path).toBe('');

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('membership=true');
    expect(calledUrl).toContain('simple=true');
  });

  it('returns empty array when API returns no projects', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse([]));
    const config = testConfig();

    const result = await getUserProjects(config, { fetchFn: mockFetch, logger: noopLogger });
    expect(result).toEqual([]);
  });
});
