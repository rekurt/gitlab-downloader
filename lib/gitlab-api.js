const API_PREFIX = '/api/v4';

export class GitLabApiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'GitLabApiError';
    this.status = options.status ?? null;
    this.responseBody = options.responseBody ?? null;
    this.ambiguous = options.ambiguous ?? false;
  }
}

function buildApiUrl(connection, path, query = {}) {
  const url = new URL(`${API_PREFIX}${path}`, `${connection.url.replace(/\/+$/, '')}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

function retryDelay(response, fallbackMs) {
  const raw = response?.headers?.get('retry-after');
  if (raw !== null && raw !== undefined) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  return fallbackMs;
}

async function wait(milliseconds, signal) {
  if (milliseconds === 0) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function requestGitLab(connection, path, options = {}) {
  const {
    method = 'GET',
    query,
    body,
    signal,
    fetchFn = globalThis.fetch,
    timeoutMs = 30_000,
    maxAttempts = 3,
    retryDelayMs = 250,
    allowNotFound = false,
    returnResponse = false,
  } = options;
  const safeMethod = method === 'GET' || method === 'HEAD';
  const attempts = safeMethod ? Math.max(1, maxAttempts) : 1;
  const url = buildApiUrl(connection, path, query);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response;
    try {
      response = await fetchFn(url, {
        method,
        headers: {
          Accept: 'application/json',
          'PRIVATE-TOKEN': connection.token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (attempt < attempts) {
        await wait(retryDelayMs * attempt, signal);
        continue;
      }
      throw new GitLabApiError(`GitLab ${method} ${path} did not return a response`, {
        cause: error,
        ambiguous: !safeMethod,
      });
    }

    if (allowNotFound && response.status === 404) return returnResponse ? { data: null, response } : null;

    if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
      await response.text();
      await wait(retryDelay(response, retryDelayMs * attempt), signal);
      continue;
    }

    const raw = await response.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    }

    if (!response.ok) {
      throw new GitLabApiError(`GitLab ${method} ${path} failed with HTTP ${response.status}`, {
        status: response.status,
        responseBody: data,
      });
    }
    return returnResponse ? { data, response } : data;
  }

  throw new GitLabApiError(`GitLab ${method} ${path} failed`);
}

async function getAllPages(connection, path, query = {}, options = {}) {
  const results = [];
  let page = 1;
  while (page) {
    const { data, response } = await requestGitLab(connection, path, {
      ...options,
      query: { ...query, per_page: 100, page },
      returnResponse: true,
    });
    if (!Array.isArray(data)) throw new GitLabApiError(`GitLab ${path} returned a non-array page`);
    results.push(...data);
    const nextPage = response.headers.get('x-next-page');
    page = nextPage ? Number(nextPage) : 0;
  }
  return results;
}

export const getGitLabVersion = (connection, options) =>
  requestGitLab(connection, '/version', options);

export const getCurrentUser = (connection, options) =>
  requestGitLab(connection, '/user', options);

export const getApplicationSettings = (connection, options = {}) =>
  requestGitLab(connection, '/application/settings', options);

export const getGroup = (connection, fullPath, options = {}) =>
  requestGitLab(connection, `/groups/${encodeURIComponent(fullPath)}`, {
    ...options,
    allowNotFound: true,
  });

export const getProject = (connection, fullPath, options = {}) =>
  requestGitLab(connection, `/projects/${encodeURIComponent(fullPath)}`, {
    ...options,
    allowNotFound: true,
  });

export const listSubgroups = (connection, groupPath, options = {}) =>
  getAllPages(connection, `/groups/${encodeURIComponent(groupPath)}/subgroups`, {}, options);

export const listGroupProjects = (connection, groupPath, options = {}) =>
  getAllPages(
    connection,
    `/groups/${encodeURIComponent(groupPath)}/projects`,
    { include_subgroups: false },
    options,
  );

export const createGroup = (connection, input, options = {}) =>
  requestGitLab(connection, '/groups', {
    ...options,
    method: 'POST',
    body: {
      name: input.name,
      path: input.path,
      ...(input.parentId === undefined || input.parentId === null
        ? {}
        : { parent_id: input.parentId }),
      visibility: input.visibility ?? 'private',
    },
  });

export const createProject = (connection, input, options = {}) =>
  requestGitLab(connection, '/projects', {
    ...options,
    method: 'POST',
    body: {
      name: input.name,
      path: input.path,
      namespace_id: input.namespaceId,
      visibility: input.visibility ?? 'private',
    },
  });

function bulkEntity(entity) {
  return {
    source_type: `${entity.sourceType}_entity`,
    source_full_path: entity.sourceFullPath,
    destination_namespace: entity.destinationNamespace,
    destination_slug: entity.destinationSlug,
    migrate_memberships: true,
    ...(entity.sourceType === 'group' ? { migrate_projects: true } : {}),
  };
}

export function startBulkImport(destination, source, entities, options = {}) {
  return requestGitLab(destination, '/bulk_imports', {
    ...options,
    method: 'POST',
    body: {
      configuration: { url: source.url, access_token: source.token },
      entities: entities.map(bulkEntity),
    },
  });
}

export const getBulkImport = (destination, importId, options) =>
  requestGitLab(destination, `/bulk_imports/${encodeURIComponent(importId)}`, options);

export const getBulkImportEntities = (destination, importId, options = {}) =>
  getAllPages(destination, `/bulk_imports/${encodeURIComponent(importId)}/entities`, {}, options);

export const getBulkImportFailures = (destination, importId, entityId, options = {}) =>
  getAllPages(
    destination,
    `/bulk_imports/${encodeURIComponent(importId)}/entities/${encodeURIComponent(entityId)}/failures`,
    {},
    options,
  );

export const cancelBulkImport = (destination, importId, options = {}) =>
  requestGitLab(destination, `/bulk_imports/${encodeURIComponent(importId)}/cancel`, {
    ...options,
    method: 'POST',
  });
