import { jest } from '@jest/globals';
import { mkdtempSync, readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readCache,
  writeCache,
  tokenValid,
  cacheMatches,
  normalizeOAuthPayload,
  refreshAccessToken,
  deviceAuthorize,
  pollDeviceToken,
  resolveAccessToken,
} from '../auth.js';

// Helper to create a mock fetch response
function mockResponse(body, { status = 200 } = {}) {
  return {
    status,
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
    authMethod: 'token',
    oauthClientId: 'test-client-id',
    oauthClientSecret: null,
    oauthScope: 'read_api read_repository',
    oauthCachePath: join(mkdtempSync(join(tmpdir(), 'auth-test-')), 'oauth_token.json'),
    ...overrides,
  };
}

const noopLogger = () => {};
const instantSleep = () => Promise.resolve();

describe('readCache', () => {
  it('returns null when file does not exist', () => {
    expect(readCache('/nonexistent/path/token.json')).toBeNull();
  });

  it('reads and parses valid JSON cache', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-read-'));
    const path = join(dir, 'token.json');
    writeFileSync(path, JSON.stringify({ access_token: 'abc123' }));
    const result = readCache(path);
    expect(result).toEqual({ access_token: 'abc123' });
  });

  it('returns null for invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-invalid-'));
    const path = join(dir, 'token.json');
    writeFileSync(path, 'not valid json {{{');
    expect(readCache(path, noopLogger)).toBeNull();
  });
});

describe('writeCache', () => {
  it('writes JSON with 0o600 file permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-write-'));
    const path = join(dir, 'sub', 'oauth_token.json');
    const payload = { access_token: 'secret', expires_at: 9999999999 };

    writeCache(path, payload);

    const content = JSON.parse(readFileSync(path, 'utf-8'));
    expect(content).toEqual(payload);

    const fileStat = statSync(path);
    // Check file permissions are 0o600 (owner read/write only)
    const fileMode = fileStat.mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it('creates parent directories recursively', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-mkdir-'));
    const path = join(dir, 'a', 'b', 'c', 'token.json');

    writeCache(path, { test: true });

    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    expect(content).toEqual({ test: true });
  });
});

describe('tokenValid', () => {
  it('returns false when access_token is missing', () => {
    expect(tokenValid({ expires_at: Math.floor(Date.now() / 1000) + 3600 })).toBe(false);
  });

  it('returns false when expires_at is missing', () => {
    expect(tokenValid({ access_token: 'abc' })).toBe(false);
  });

  it('returns false when expires_at is not a number', () => {
    expect(tokenValid({ access_token: 'abc', expires_at: 'not-a-number' })).toBe(false);
  });

  it('returns false when token will expire within minTtl', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(tokenValid({ access_token: 'abc', expires_at: now + 30 }, 60)).toBe(false);
  });

  it('returns true when token has sufficient TTL', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(tokenValid({ access_token: 'abc', expires_at: now + 3600 }, 60)).toBe(true);
  });

  it('returns true with default minTtl', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(tokenValid({ access_token: 'abc', expires_at: now + 120 })).toBe(true);
  });
});

describe('cacheMatches', () => {
  it('returns true when all fields match', () => {
    const config = testConfig({ authMethod: 'oauth' });
    const cached = {
      instance_url: config.url,
      client_id: config.oauthClientId,
      scope: 'read_api read_repository',
    };
    expect(cacheMatches(config, cached)).toBe(true);
  });

  it('returns false when instance_url differs', () => {
    const config = testConfig({ authMethod: 'oauth' });
    const cached = {
      instance_url: 'https://other-gitlab.com',
      client_id: config.oauthClientId,
      scope: 'read_api read_repository',
    };
    expect(cacheMatches(config, cached)).toBe(false);
  });

  it('returns false when client_id differs', () => {
    const config = testConfig({ authMethod: 'oauth' });
    const cached = {
      instance_url: config.url,
      client_id: 'other-client-id',
      scope: 'read_api read_repository',
    };
    expect(cacheMatches(config, cached)).toBe(false);
  });

  it('returns false when scope differs', () => {
    const config = testConfig({ authMethod: 'oauth' });
    const cached = {
      instance_url: config.url,
      client_id: config.oauthClientId,
      scope: 'api',
    };
    expect(cacheMatches(config, cached)).toBe(false);
  });

  it('normalizes scope whitespace', () => {
    const config = testConfig({ oauthScope: '  read_api   read_repository  ' });
    const cached = {
      instance_url: config.url,
      client_id: config.oauthClientId,
      scope: 'read_api read_repository',
    };
    expect(cacheMatches(config, cached)).toBe(true);
  });
});

describe('normalizeOAuthPayload', () => {
  it('creates normalized payload from token response', () => {
    const config = testConfig();
    const payload = {
      access_token: 'at-123',
      refresh_token: 'rt-456',
      token_type: 'Bearer',
      expires_in: 7200,
    };
    const result = normalizeOAuthPayload(config, payload);

    expect(result.instance_url).toBe(config.url);
    expect(result.client_id).toBe(config.oauthClientId);
    expect(result.scope).toBe('read_api read_repository');
    expect(result.access_token).toBe('at-123');
    expect(result.refresh_token).toBe('rt-456');
    expect(result.token_type).toBe('Bearer');
    expect(typeof result.expires_at).toBe('number');
    // expires_at should be roughly now + 7200
    const now = Math.floor(Date.now() / 1000);
    expect(result.expires_at).toBeGreaterThanOrEqual(now + 7199);
    expect(result.expires_at).toBeLessThanOrEqual(now + 7202);
  });

  it('defaults expires_in to 3600 when invalid', () => {
    const config = testConfig();
    const payload = {
      access_token: 'at-123',
      expires_in: 'not-a-number',
    };
    const result = normalizeOAuthPayload(config, payload);
    const now = Math.floor(Date.now() / 1000);
    expect(result.expires_at).toBeGreaterThanOrEqual(now + 3599);
    expect(result.expires_at).toBeLessThanOrEqual(now + 3602);
  });

  it('defaults token_type to Bearer', () => {
    const config = testConfig();
    const payload = { access_token: 'at-123' };
    const result = normalizeOAuthPayload(config, payload);
    expect(result.token_type).toBe('Bearer');
  });
});

describe('refreshAccessToken', () => {
  it('returns refreshed token on success', async () => {
    const config = testConfig();
    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse({ access_token: 'new-token', refresh_token: 'new-rt', expires_in: 3600 })
    );

    const result = await refreshAccessToken(config, 'old-refresh-token', {
      fetchFn: mockFetch,
      logger: noopLogger,
    });

    expect(result).not.toBeNull();
    expect(result.access_token).toBe('new-token');

    // Verify correct POST body
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://gitlab.example.com/oauth/token');
    expect(opts.method).toBe('POST');
    const body = new URLSearchParams(opts.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh-token');
    expect(body.get('client_id')).toBe('test-client-id');
  });

  it('includes client_secret when configured', async () => {
    const config = testConfig({ oauthClientSecret: 'my-secret' });
    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse({ access_token: 'new-token', expires_in: 3600 })
    );

    await refreshAccessToken(config, 'old-rt', { fetchFn: mockFetch, logger: noopLogger });

    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
    expect(body.get('client_secret')).toBe('my-secret');
  });

  it('returns null on non-200 response', async () => {
    const config = testConfig();
    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse('unauthorized', { status: 401 })
    );

    const result = await refreshAccessToken(config, 'old-rt', {
      fetchFn: mockFetch,
      logger: noopLogger,
    });
    expect(result).toBeNull();
  });

  it('returns null when response has no access_token', async () => {
    const config = testConfig();
    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse({ error: 'invalid_grant' })
    );

    const result = await refreshAccessToken(config, 'old-rt', {
      fetchFn: mockFetch,
      logger: noopLogger,
    });
    expect(result).toBeNull();
  });
});

describe('deviceAuthorize', () => {
  it('returns device authorization data on success', async () => {
    const config = testConfig();
    const deviceData = {
      device_code: 'dc-123',
      user_code: 'UC-456',
      verification_uri: 'https://gitlab.example.com/oauth/device',
      verification_uri_complete: 'https://gitlab.example.com/oauth/device?user_code=UC-456',
      interval: 5,
      expires_in: 300,
    };
    const mockFetch = jest.fn().mockResolvedValue(mockResponse(deviceData));

    const result = await deviceAuthorize(config, { fetchFn: mockFetch });

    expect(result).toEqual(deviceData);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://gitlab.example.com/oauth/authorize_device');
    expect(opts.method).toBe('POST');
    const body = new URLSearchParams(opts.body);
    expect(body.get('client_id')).toBe('test-client-id');
    expect(body.get('scope')).toBe('read_api read_repository');
  });

  it('throws on non-200 response', async () => {
    const config = testConfig();
    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse('bad request', { status: 400 })
    );

    await expect(deviceAuthorize(config, { fetchFn: mockFetch }))
      .rejects.toThrow('Device authorization failed');
  });

  it('throws on network error', async () => {
    const config = testConfig();
    const mockFetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(deviceAuthorize(config, { fetchFn: mockFetch }))
      .rejects.toThrow('Device authorization failed');
  });
});

describe('pollDeviceToken', () => {
  it('returns token when authorization succeeds', async () => {
    const config = testConfig();
    const tokenResponse = { access_token: 'at-789', refresh_token: 'rt-012', expires_in: 7200 };
    const mockFetch = jest.fn().mockResolvedValue(mockResponse(tokenResponse));

    const result = await pollDeviceToken(config, 'dc-123', 5, 300, {
      fetchFn: mockFetch,
      logger: noopLogger,
      sleepFn: instantSleep,
    });

    expect(result).toEqual(tokenResponse);
  });

  it('retries on authorization_pending', async () => {
    const config = testConfig();
    const pendingResponse = mockResponse({ error: 'authorization_pending' }, { status: 400 });
    const tokenResponse = mockResponse({ access_token: 'at-final', expires_in: 7200 });

    const mockFetch = jest.fn()
      .mockResolvedValueOnce(pendingResponse)
      .mockResolvedValueOnce(pendingResponse)
      .mockResolvedValueOnce(tokenResponse);

    const result = await pollDeviceToken(config, 'dc-123', 1, 300, {
      fetchFn: mockFetch,
      logger: noopLogger,
      sleepFn: instantSleep,
    });

    expect(result.access_token).toBe('at-final');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('increases wait time on slow_down', async () => {
    const config = testConfig();
    const slowDownResponse = mockResponse({ error: 'slow_down' }, { status: 400 });
    const tokenResponse = mockResponse({ access_token: 'at-final', expires_in: 7200 });

    const mockFetch = jest.fn()
      .mockResolvedValueOnce(slowDownResponse)
      .mockResolvedValueOnce(tokenResponse);

    const sleepCalls = [];
    const trackingSleep = (seconds) => {
      sleepCalls.push(seconds);
      return Promise.resolve();
    };

    const result = await pollDeviceToken(config, 'dc-123', 5, 300, {
      fetchFn: mockFetch,
      logger: noopLogger,
      sleepFn: trackingSleep,
    });

    expect(result.access_token).toBe('at-final');
    // After slow_down, wait should increase by 2: 5 -> 7
    expect(sleepCalls[0]).toBe(7);
  });

  it('throws on unexpected error', async () => {
    const config = testConfig();
    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse({ error: 'access_denied' }, { status: 400 })
    );

    await expect(
      pollDeviceToken(config, 'dc-123', 1, 300, {
        fetchFn: mockFetch,
        logger: noopLogger,
        sleepFn: instantSleep,
      })
    ).rejects.toThrow('Device token polling failed: access_denied');
  });

  it('throws when device authorization expires', async () => {
    const config = testConfig();
    const pendingResponse = mockResponse({ error: 'authorization_pending' }, { status: 400 });
    const mockFetch = jest.fn().mockResolvedValue(pendingResponse);

    // Pass expiresIn = 0 so deadline is immediately reached
    await expect(
      pollDeviceToken(config, 'dc-123', 1, 0, {
        fetchFn: mockFetch,
        logger: noopLogger,
        sleepFn: instantSleep,
      })
    ).rejects.toThrow('Device authorization expired before completion');
  });

  it('includes client_secret when configured', async () => {
    const config = testConfig({ oauthClientSecret: 'my-secret' });
    const tokenResponse = mockResponse({ access_token: 'at-123', expires_in: 3600 });
    const mockFetch = jest.fn().mockResolvedValue(tokenResponse);

    await pollDeviceToken(config, 'dc-123', 5, 300, {
      fetchFn: mockFetch,
      logger: noopLogger,
      sleepFn: instantSleep,
    });

    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
    expect(body.get('client_secret')).toBe('my-secret');
  });
});

describe('resolveAccessToken', () => {
  it('returns token directly for token auth', async () => {
    const config = testConfig({ authMethod: 'token', token: 'my-token' });
    const result = await resolveAccessToken(config);
    expect(result).toBe('my-token');
  });

  it('throws when token auth is selected but token is missing', async () => {
    const config = testConfig({ authMethod: 'token', token: null });
    await expect(resolveAccessToken(config)).rejects.toThrow('Token auth is selected but token is missing');
  });

  it('throws when oauth auth is selected but client id is missing', async () => {
    const config = testConfig({ authMethod: 'oauth', oauthClientId: null });
    await expect(resolveAccessToken(config)).rejects.toThrow('OAuth auth is selected but oauth client id is missing');
  });

  it('returns cached token when valid and matching', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-resolve-'));
    const cachePath = join(dir, 'oauth_token.json');
    const config = testConfig({
      authMethod: 'oauth',
      oauthCachePath: cachePath,
    });

    const cachedPayload = {
      instance_url: config.url,
      client_id: config.oauthClientId,
      scope: 'read_api read_repository',
      access_token: 'cached-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    writeFileSync(cachePath, JSON.stringify(cachedPayload));

    const result = await resolveAccessToken(config, { logger: noopLogger });
    expect(result).toBe('cached-token');
  });

  it('refreshes expired cached token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-refresh-'));
    const cachePath = join(dir, 'oauth_token.json');
    const config = testConfig({
      authMethod: 'oauth',
      oauthCachePath: cachePath,
    });

    const cachedPayload = {
      instance_url: config.url,
      client_id: config.oauthClientId,
      scope: 'read_api read_repository',
      access_token: 'expired-token',
      refresh_token: 'valid-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) - 100,
    };
    writeFileSync(cachePath, JSON.stringify(cachedPayload));

    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse({
        access_token: 'refreshed-token',
        refresh_token: 'new-rt',
        expires_in: 7200,
      })
    );

    const result = await resolveAccessToken(config, {
      fetchFn: mockFetch,
      logger: noopLogger,
    });

    expect(result).toBe('refreshed-token');

    // Verify the cache was updated
    const updatedCache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    expect(updatedCache.access_token).toBe('refreshed-token');
  });

  it('falls back to device flow when refresh fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-device-'));
    const cachePath = join(dir, 'oauth_token.json');
    const config = testConfig({
      authMethod: 'oauth',
      oauthCachePath: cachePath,
    });

    const cachedPayload = {
      instance_url: config.url,
      client_id: config.oauthClientId,
      scope: 'read_api read_repository',
      access_token: 'expired-token',
      refresh_token: 'bad-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) - 100,
    };
    writeFileSync(cachePath, JSON.stringify(cachedPayload));

    const deviceData = {
      device_code: 'dc-123',
      user_code: 'UC-456',
      verification_uri: 'https://gitlab.example.com/oauth/device',
      verification_uri_complete: 'https://gitlab.example.com/oauth/device?user_code=UC-456',
      interval: 5,
      expires_in: 300,
    };

    let callCount = 0;
    const mockFetch = jest.fn().mockImplementation(async (url) => {
      callCount++;
      if (callCount === 1) {
        // First call: refresh fails
        return mockResponse({ error: 'invalid_grant' }, { status: 400 });
      }
      if (callCount === 2) {
        // Second call: device authorize
        return mockResponse(deviceData);
      }
      // Third call: poll returns token
      return mockResponse({
        access_token: 'device-flow-token',
        refresh_token: 'new-rt',
        expires_in: 7200,
      });
    });

    let deviceCodeInfo = null;
    const result = await resolveAccessToken(config, {
      fetchFn: mockFetch,
      logger: noopLogger,
      sleepFn: instantSleep,
      onDeviceCode: (info) => { deviceCodeInfo = info; },
    });

    expect(result).toBe('device-flow-token');
    expect(deviceCodeInfo).not.toBeNull();
    expect(deviceCodeInfo.verificationUriComplete).toContain('user_code=UC-456');
  });

  it('runs full device flow when no cache exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-full-'));
    const cachePath = join(dir, 'oauth_token.json');
    const config = testConfig({
      authMethod: 'oauth',
      oauthCachePath: cachePath,
    });

    const deviceData = {
      device_code: 'dc-abc',
      user_code: 'UC-XYZ',
      verification_uri: 'https://gitlab.example.com/oauth/device',
      interval: 5,
      expires_in: 300,
    };

    let callCount = 0;
    const mockFetch = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return mockResponse(deviceData);
      }
      return mockResponse({
        access_token: 'fresh-token',
        refresh_token: 'fresh-rt',
        expires_in: 7200,
      });
    });

    let deviceCodeInfo = null;
    const result = await resolveAccessToken(config, {
      fetchFn: mockFetch,
      logger: noopLogger,
      sleepFn: instantSleep,
      onDeviceCode: (info) => { deviceCodeInfo = info; },
    });

    expect(result).toBe('fresh-token');
    expect(deviceCodeInfo).not.toBeNull();
    expect(deviceCodeInfo.userCode).toBe('UC-XYZ');

    // Verify cache was written
    expect(existsSync(cachePath)).toBe(true);
    const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    expect(cache.access_token).toBe('fresh-token');
  });

  it('throws when device flow returns no device_code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-nodc-'));
    const cachePath = join(dir, 'oauth_token.json');
    const config = testConfig({
      authMethod: 'oauth',
      oauthCachePath: cachePath,
    });

    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse({ verification_uri: 'https://example.com', user_code: 'ABC' })
    );

    await expect(
      resolveAccessToken(config, {
        fetchFn: mockFetch,
        logger: noopLogger,
      })
    ).rejects.toThrow('OAuth device flow failed: missing device_code');
  });

  it('throws when no verification url and no onDeviceCode callback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-nouri-'));
    const cachePath = join(dir, 'oauth_token.json');
    const config = testConfig({
      authMethod: 'oauth',
      oauthCachePath: cachePath,
    });

    const mockFetch = jest.fn().mockResolvedValue(
      mockResponse({ device_code: 'dc-123' })
    );

    await expect(
      resolveAccessToken(config, {
        fetchFn: mockFetch,
        logger: noopLogger,
      })
    ).rejects.toThrow('OAuth device flow failed: missing verification url');
  });

  it('skips cache when instance_url does not match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-mismatch-'));
    const cachePath = join(dir, 'oauth_token.json');
    const config = testConfig({
      authMethod: 'oauth',
      oauthCachePath: cachePath,
    });

    const cachedPayload = {
      instance_url: 'https://other-gitlab.com',
      client_id: config.oauthClientId,
      scope: 'read_api read_repository',
      access_token: 'wrong-instance-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    writeFileSync(cachePath, JSON.stringify(cachedPayload));

    const deviceData = {
      device_code: 'dc-new',
      user_code: 'UC-NEW',
      verification_uri_complete: 'https://gitlab.example.com/oauth/device?user_code=UC-NEW',
      interval: 5,
      expires_in: 300,
    };

    let callCount = 0;
    const mockFetch = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockResponse(deviceData);
      return mockResponse({ access_token: 'correct-token', expires_in: 7200 });
    });

    const result = await resolveAccessToken(config, {
      fetchFn: mockFetch,
      logger: noopLogger,
      sleepFn: instantSleep,
      onDeviceCode: () => {},
    });

    expect(result).toBe('correct-token');
  });
});
