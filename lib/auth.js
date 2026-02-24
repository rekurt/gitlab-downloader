import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { openSync, closeSync } from 'node:fs';
import { RETRY_BACKOFF_MAX } from './constants.js';

const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const REFRESH_GRANT_TYPE = 'refresh_token';

/**
 * Current epoch timestamp in seconds.
 * @returns {number}
 */
function now() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Normalize OAuth scope string (collapse whitespace).
 * @param {string} scope
 * @returns {string}
 */
function safeScope(scope) {
  return scope
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * Sleep for the given number of seconds.
 * @param {number} seconds
 * @returns {Promise<void>}
 */
function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Read cached OAuth token from disk.
 * @param {string} path
 * @param {function} [logger]
 * @returns {object|null}
 */
export function readCache(path, logger = () => {}) {
  try {
    if (!existsSync(path)) return null;
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    logger('warn', 'Failed to read OAuth cache from %s: %s', path, err?.message || err);
    return null;
  }
}

/**
 * Write OAuth token cache to disk with secure file permissions (0o600).
 * @param {string} path
 * @param {object} payload
 */
export function writeCache(path, payload) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // ignore if chmod fails (e.g., on some platforms)
  }
  const fd = openSync(path, 'w', 0o600);
  try {
    const content = JSON.stringify(payload, null, 2);
    writeFileSync(fd, content, 'utf-8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Check whether a cached token is still valid.
 * @param {object} payload
 * @param {number} [minTtl=60] - Minimum remaining TTL in seconds
 * @returns {boolean}
 */
export function tokenValid(payload, minTtl = 60) {
  const token = payload?.access_token;
  const expiresAt = payload?.expires_at;
  if (!token) return false;
  if (typeof expiresAt !== 'number') return false;
  return (now() + minTtl) < expiresAt;
}

/**
 * Check whether cached token matches the current config (instance URL, client ID, scope).
 * @param {object} config - GitlabConfig object
 * @param {object} cached - Cached token payload
 * @returns {boolean}
 */
export function cacheMatches(config, cached) {
  return (
    cached?.instance_url === config.url &&
    cached?.client_id === config.oauthClientId &&
    cached?.scope === safeScope(config.oauthScope)
  );
}

/**
 * Normalize an OAuth token payload for caching.
 * @param {object} config - GitlabConfig object
 * @param {object} payload - Raw token response from OAuth server
 * @returns {object}
 */
export function normalizeOAuthPayload(config, payload) {
  let expiresIn;
  try {
    expiresIn = parseInt(payload.expires_in, 10);
    if (Number.isNaN(expiresIn)) expiresIn = 3600;
  } catch {
    expiresIn = 3600;
  }
  return {
    instance_url: config.url,
    client_id: config.oauthClientId,
    scope: safeScope(config.oauthScope),
    access_token: payload.access_token || null,
    refresh_token: payload.refresh_token || null,
    token_type: payload.token_type || 'Bearer',
    expires_at: now() + Math.max(1, expiresIn),
  };
}

/**
 * Request a token from the OAuth token endpoint.
 * @param {string} gitlabUrl
 * @param {object} data - Form data to POST
 * @param {object} [options]
 * @param {typeof globalThis.fetch} [options.fetchFn]
 * @param {function} [options.logger]
 * @returns {Promise<object|null>}
 */
async function requestToken(gitlabUrl, data, options = {}) {
  const { fetchFn = globalThis.fetch, logger = () => {} } = options;
  const url = `${gitlabUrl}/oauth/token`;

  const body = new URLSearchParams(data);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status !== 200) {
      const text = await response.text();
      logger('warn', 'OAuth token endpoint error: %d %s', response.status, text.slice(0, 200));
      return null;
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    logger('warn', 'OAuth token request failed: %s', err?.message || err);
    return null;
  }
}

/**
 * Refresh an OAuth access token using a refresh token.
 * @param {object} config - GitlabConfig object
 * @param {string} refreshToken
 * @param {object} [options]
 * @param {typeof globalThis.fetch} [options.fetchFn]
 * @param {function} [options.logger]
 * @returns {Promise<object|null>}
 */
export async function refreshAccessToken(config, refreshToken, options = {}) {
  const data = {
    grant_type: REFRESH_GRANT_TYPE,
    refresh_token: refreshToken,
    client_id: config.oauthClientId || '',
  };
  if (config.oauthClientSecret) {
    data.client_secret = config.oauthClientSecret;
  }
  const payload = await requestToken(config.url, data, options);
  if (!payload || !payload.access_token) return null;
  return payload;
}

/**
 * Initiate OAuth Device Authorization (RFC 8628).
 * @param {object} config - GitlabConfig object
 * @param {object} [options]
 * @param {typeof globalThis.fetch} [options.fetchFn]
 * @returns {Promise<object>} Device authorization response
 */
export async function deviceAuthorize(config, options = {}) {
  const { fetchFn = globalThis.fetch } = options;
  const url = `${config.url}/oauth/authorize_device`;

  const body = new URLSearchParams({
    client_id: config.oauthClientId || '',
    scope: safeScope(config.oauthScope),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const text = await response.text();

    if (response.status !== 200) {
      throw new Error(`Device authorization failed: ${response.status} ${text.slice(0, 200)}`);
    }

    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err?.message?.startsWith('Device authorization failed:')) throw err;
    throw new Error(`Device authorization failed: ${err?.message || err}`);
  }
}

/**
 * Poll for device token (OAuth Device Flow).
 * Handles authorization_pending and slow_down responses per RFC 8628.
 *
 * @param {object} config - GitlabConfig object
 * @param {string} deviceCode
 * @param {number} interval - Polling interval in seconds
 * @param {number} expiresIn - Total seconds before expiry
 * @param {object} [options]
 * @param {typeof globalThis.fetch} [options.fetchFn]
 * @param {function} [options.logger]
 * @param {function} [options.sleepFn] - Custom sleep function (for testing)
 * @returns {Promise<object>} Token response
 */
export async function pollDeviceToken(config, deviceCode, interval, expiresIn, options = {}) {
  const { fetchFn = globalThis.fetch, logger = () => {}, sleepFn = sleep } = options;
  const deadline = now() + Math.max(1, expiresIn);
  let waitSeconds = Math.max(1, interval);

  while (now() < deadline) {
    const data = {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: deviceCode,
      client_id: config.oauthClientId || '',
    };
    if (config.oauthClientSecret) {
      data.client_secret = config.oauthClientSecret;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetchFn(`${config.url}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const body = await response.json();

      if (response.status === 200 && body && body.access_token) {
        return body;
      }

      const error = typeof body === 'object' ? String(body.error || '') : '';

      if (error === 'authorization_pending') {
        await sleepFn(waitSeconds);
        continue;
      }

      if (error === 'slow_down') {
        waitSeconds = Math.min(waitSeconds + 2, RETRY_BACKOFF_MAX);
        await sleepFn(waitSeconds);
        continue;
      }

      throw new Error(`Device token polling failed: ${error || response.status}`);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err?.message?.startsWith('Device token polling failed:')) throw err;
      throw new Error(`Device token polling failed: ${err?.message || err}`);
    }
  }

  throw new Error('Device authorization expired before completion');
}

/**
 * Main entry point: resolve an access token based on config.
 * For token auth, returns the token directly.
 * For OAuth, tries cache -> refresh -> device flow.
 *
 * @param {object} config - GitlabConfig object
 * @param {object} [options]
 * @param {typeof globalThis.fetch} [options.fetchFn] - Custom fetch (for testing)
 * @param {function} [options.logger] - Logger function(level, message, ...args)
 * @param {function} [options.sleepFn] - Custom sleep (for testing)
 * @param {function} [options.onDeviceCode] - Callback when device code is received (verification_uri, user_code, verification_uri_complete)
 * @returns {Promise<string>} Access token
 */
export async function resolveAccessToken(config, options = {}) {
  const { logger = () => {}, onDeviceCode } = options;

  if (config.authMethod === 'token') {
    if (!config.token) {
      throw new Error('Token auth is selected but token is missing');
    }
    return config.token;
  }

  if (!config.oauthClientId) {
    throw new Error('OAuth auth is selected but oauth client id is missing');
  }

  const cached = readCache(config.oauthCachePath, logger);

  if (cached && cacheMatches(config, cached) && tokenValid(cached)) {
    return String(cached.access_token);
  }

  // Try refresh if we have a cached token with matching config
  if (cached && cacheMatches(config, cached)) {
    const refreshTokenValue = cached.refresh_token;
    if (typeof refreshTokenValue === 'string' && refreshTokenValue) {
      const refreshed = await refreshAccessToken(config, refreshTokenValue, options);
      if (refreshed) {
        const normalized = normalizeOAuthPayload(config, refreshed);
        writeCache(config.oauthCachePath, normalized);
        return String(normalized.access_token);
      }
    }
  }

  // Full device flow
  const deviceData = await deviceAuthorize(config, options);
  const verificationUri = String(deviceData.verification_uri || '');
  const verificationUriComplete = String(deviceData.verification_uri_complete || '');
  const userCode = String(deviceData.user_code || '');
  const deviceInterval = parseInt(deviceData.interval, 10) || 5;
  const deviceExpiresIn = parseInt(deviceData.expires_in, 10) || 300;
  const deviceCode = String(deviceData.device_code || '');

  if (!deviceCode) {
    throw new Error('OAuth device flow failed: missing device_code');
  }

  if (onDeviceCode) {
    onDeviceCode({
      verificationUri,
      verificationUriComplete,
      userCode,
    });
  } else if (verificationUriComplete) {
    console.log(`Open in browser: ${verificationUriComplete}`);
  } else if (verificationUri && userCode) {
    console.log(`Open in browser: ${verificationUri}`);
    console.log(`Enter code: ${userCode}`);
  } else {
    throw new Error('OAuth device flow failed: missing verification url');
  }

  const tokenPayload = await pollDeviceToken(config, deviceCode, deviceInterval, deviceExpiresIn, options);
  const normalized = normalizeOAuthPayload(config, tokenPayload);
  writeCache(config.oauthCachePath, normalized);
  return String(normalized.access_token);
}
