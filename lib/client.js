import { GITLAB_API_VERSION, RETRY_BACKOFF_MAX } from './constants.js';
import { extractGroupPath } from './utils.js';

/**
 * Get a header value from a Headers object or plain object.
 * @param {Headers|Record<string,string>} headers
 * @param {string} name
 * @returns {string|null}
 */
function headerGet(headers, name) {
  if (typeof headers.get === 'function') {
    return headers.get(name);
  }
  if (headers && typeof headers === 'object') {
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  }
  return null;
}

/**
 * Calculate delay based on rate limit headers.
 * Returns 0 if no delay needed, otherwise seconds to wait.
 * @param {Headers|Record<string,string>} headers
 * @returns {number}
 */
export function maybeRateLimitDelay(headers) {
  const remainingRaw = headerGet(headers, 'RateLimit-Remaining');
  const resetRaw = headerGet(headers, 'RateLimit-Reset');
  if (!remainingRaw || !resetRaw) return 0;

  const remaining = parseInt(remainingRaw, 10);
  const resetAt = parseInt(resetRaw, 10);
  if (Number.isNaN(remaining) || Number.isNaN(resetAt)) return 0;
  if (remaining >= 10) return 0;

  const now = Math.floor(Date.now() / 1000);
  const waitSeconds = Math.max(resetAt - now, 1);
  return Math.min(waitSeconds, 30);
}

/**
 * Parse Retry-After header value.
 * @param {Headers|Record<string,string>} headers
 * @returns {number|null}
 */
function retryAfterSeconds(headers) {
  const raw = headerGet(headers, 'Retry-After');
  if (raw === null || raw === undefined) return null;
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return null;
  return Math.max(0, Math.min(value, RETRY_BACKOFF_MAX));
}

/**
 * Calculate next retry delay with jitter.
 * @param {number} baseDelay
 * @param {Headers|Record<string,string>} headers
 * @returns {number}
 */
function nextDelay(baseDelay, headers) {
  const retryAfter = retryAfterSeconds(headers);
  if (retryAfter !== null) return retryAfter;
  const jitter = 0.05 + Math.random() * 0.45;
  return Math.min(baseDelay + jitter, RETRY_BACKOFF_MAX);
}

/**
 * Sleep for the given number of seconds. Respects AbortSignal.
 * @param {number} seconds
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function sleep(seconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, seconds * 1000);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Build the full API URL with query params.
 * @param {string} baseUrl
 * @param {Record<string,string>} params
 * @returns {string}
 */
function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Create default headers for GitLab API requests.
 * @param {string|null} token
 * @returns {Record<string,string>}
 */
function buildHeaders(token) {
  const headers = { Accept: 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Fetch JSON from a URL with retry logic, timeout, and rate limit handling.
 *
 * @param {string} url - The URL to fetch
 * @param {Record<string,string>} params - Query parameters
 * @param {string} description - Description for logging
 * @param {object} config - GitlabConfig object
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - AbortSignal for cancellation
 * @param {function} [options.logger] - Logger function(level, message, ...args)
 * @param {typeof globalThis.fetch} [options.fetchFn] - Custom fetch implementation (for testing)
 * @returns {Promise<Array|object>}
 */
export async function fetchJson(url, params, description, config, options = {}) {
  const { signal, logger = () => {}, fetchFn = globalThis.fetch } = options;
  let delay = 1.0;
  const timeoutMs = (config.requestTimeout || 30) * 1000;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    let timeoutId;
    let abortController;
    let onExternalAbort;

    try {
      abortController = new AbortController();

      // Propagate external signal to our controller (compatible with Node.js 18 / Electron 27)
      if (signal) {
        if (signal.aborted) {
          abortController.abort(signal.reason);
        } else {
          onExternalAbort = () => abortController.abort(signal.reason);
          signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      timeoutId = setTimeout(() => abortController.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);

      const fullUrl = buildUrl(url, params);
      const response = await fetchFn(fullUrl, {
        headers: buildHeaders(config.token),
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);
      if (onExternalAbort) signal.removeEventListener('abort', onExternalAbort);

      if (response.status === 429 || response.status >= 500) {
        const text = await response.text();
        logger('warn', '%s attempt %d failed with status %d: %s', description, attempt, response.status, text.slice(0, 200));
        if (attempt < config.maxRetries) {
          await sleep(nextDelay(delay, response.headers), signal);
          delay = Math.min(delay * 2, RETRY_BACKOFF_MAX);
        }
        continue;
      }

      if (response.status !== 200) {
        const text = await response.text();
        logger('error', 'Failed to fetch %s: %d %s', description, response.status, text.slice(0, 200));
        const httpErr = new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        httpErr.nonRetriable = true;
        throw httpErr;
      }

      const pause = maybeRateLimitDelay(response.headers);
      if (pause > 0) {
        logger('warn', 'Rate limit is low, sleeping %.1f seconds', pause);
        await sleep(pause, signal);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (onExternalAbort) signal.removeEventListener('abort', onExternalAbort);

      if (err?.name === 'AbortError' && signal?.aborted) {
        throw err;
      }

      if (err?.nonRetriable) {
        throw err;
      }

      if (err?.name === 'TimeoutError' || err?.message === 'Timeout') {
        logger('warn', 'Timeout fetching %s (attempt %d)', description, attempt);
      } else {
        logger('warn', 'Error fetching %s (attempt %d): %s', description, attempt, err?.message || err);
      }

      if (attempt < config.maxRetries) {
        await sleep(Math.min(delay + Math.random() * 0.45 + 0.05, RETRY_BACKOFF_MAX), signal);
        delay = Math.min(delay * 2, RETRY_BACKOFF_MAX);
      }
    }
  }

  logger('error', 'Giving up on %s after %d attempts', description, config.maxRetries);
  throw new Error(`Request failed after ${config.maxRetries} attempts: ${description}`);
}

/**
 * Fetch all pages of a paginated GitLab API endpoint.
 *
 * @param {string} url - The base URL
 * @param {Record<string,string>} baseParams - Base query parameters
 * @param {string} description - Description for logging
 * @param {object} config - GitlabConfig object
 * @param {object} [options] - Same options as fetchJson
 * @returns {Promise<Array<object>>}
 */
export async function fetchPaginated(url, baseParams, description, config, options = {}) {
  let page = 1;
  const results = [];

  while (true) {
    const params = {
      ...baseParams,
      per_page: String(config.perPage),
      page: String(page),
    };

    const data = await fetchJson(url, params, `${description} page ${page}`, config, options);

    if (!Array.isArray(data)) {
      throw new Error(`Unexpected payload for ${description} at page ${page}`);
    }
    if (data.length === 0) break;

    results.push(...data);

    if (data.length < config.perPage) break;
    page += 1;
  }

  return results;
}

/**
 * Fetch group metadata by ID or path.
 *
 * @param {object} config - GitlabConfig object
 * @param {object} [options] - Same options as fetchJson
 * @returns {Promise<object>}
 */
export async function fetchGroupMetadata(config, options = {}) {
  if (!config.group) {
    throw new Error('Group is not set');
  }

  const encodedGroup = encodeURIComponent(config.group);
  const url = `${config.url}/api/${GITLAB_API_VERSION}/groups/${encodedGroup}`;
  const data = await fetchJson(url, {}, 'group metadata', config, options);

  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Unable to fetch group metadata. Check group and token permissions');
  }

  return data;
}

/**
 * Recursively fetch all projects from a group and its subgroups using BFS.
 *
 * @param {object} config - GitlabConfig object
 * @param {string} rootFullPath - The full path of the root group
 * @param {object} [options] - Same options as fetchJson
 * @returns {Promise<Array<object>>}
 */
export async function getAllProjects(config, rootFullPath, options = {}) {
  if (!config.group) return [];

  const { logger = () => {} } = options;
  const baseUrl = `${config.url}/api/${GITLAB_API_VERSION}/groups`;
  const projects = [];
  const toVisit = [{ id: config.group, fullPath: rootFullPath }];

  while (toVisit.length > 0) {
    const current = toVisit.shift();
    const groupId = current.id;
    const groupPath = current.fullPath;
    logger('info', 'Fetching projects for group %s (%s)', groupPath, groupId);

    const encodedGroupId = encodeURIComponent(String(groupId));

    const projectItems = await fetchPaginated(
      `${baseUrl}/${encodedGroupId}/projects`,
      { include_subgroups: 'false' },
      `projects for group ${groupPath}`,
      config,
      options,
    );

    for (const project of projectItems) {
      const pathWithNamespace = project.path_with_namespace || '';
      project.group_path = extractGroupPath(rootFullPath, pathWithNamespace);
      projects.push(project);
    }

    const subgroups = await fetchPaginated(
      `${baseUrl}/${encodedGroupId}/subgroups`,
      {},
      `subgroups for group ${groupPath}`,
      config,
      options,
    );

    for (const subgroup of subgroups) {
      const subgroupId = String(subgroup.id);
      const subgroupPath = subgroup.full_path || subgroup.path || subgroupId;
      toVisit.push({ id: subgroupId, fullPath: subgroupPath });
    }
  }

  return projects;
}

/**
 * Fetch all projects accessible to the current user.
 *
 * @param {object} config - GitlabConfig object
 * @param {object} [options] - Same options as fetchJson
 * @returns {Promise<Array<object>>}
 */
export async function getUserProjects(config, options = {}) {
  const projects = await fetchPaginated(
    `${config.url}/api/${GITLAB_API_VERSION}/projects`,
    { membership: 'true', simple: 'true' },
    'projects for current user',
    config,
    options,
  );

  for (const project of projects) {
    const pathWithNamespace = String(project.path_with_namespace || '');
    const parent = pathWithNamespace.includes('/')
      ? pathWithNamespace.slice(0, pathWithNamespace.lastIndexOf('/'))
      : '';
    project.group_path = parent;
  }

  return projects;
}
