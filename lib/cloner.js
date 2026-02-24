import { spawn } from 'node:child_process';
import { mkdir, rm, access } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DEFAULT_CLONE_RETRIES, RETRY_BACKOFF_MAX } from './constants.js';
import {
  sanitizePathComponent,
  sanitizeGitOutput,
  buildAuthenticatedCloneUrl,
} from './utils.js';

/**
 * Lock for credential helper operations (only one at a time per host).
 * @type {Map<string, Promise<void>>}
 */
const _credentialLocks = new Map();

/**
 * Set of hosts that already have credentials stored in the helper.
 * @type {Set<string>}
 */
const _credentialReadyHosts = new Set();

/**
 * Run a git command via child_process.spawn with output capture.
 *
 * @param {string[]} args - Command arguments (e.g., ['git', 'clone', ...])
 * @param {object} [options]
 * @param {Record<string,string>} [options.env] - Extra env vars (merged with process.env)
 * @param {string} [options.stdinText] - Text to write to stdin
 * @param {AbortSignal} [options.signal] - AbortSignal for cancellation
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runGitCommand(args, options = {}) {
  const { env, stdinText, signal } = options;

  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    const proc = spawn(args[0], args.slice(1), {
      env: env ? { ...process.env, ...env } : process.env,
      stdio: [stdinText !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    const onAbort = () => {
      proc.kill('SIGTERM');
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    proc.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8').trim(),
        stderr: Buffer.concat(stderrChunks).toString('utf-8').trim(),
      });
    });

    if (stdinText !== undefined) {
      proc.stdin.write(stdinText);
      proc.stdin.end();
    }
  });
}

/**
 * Ensure credentials are stored in the git credential helper for a given host.
 *
 * @param {string} repoUrl - Repository HTTPS URL
 * @param {string|null} token - Access token
 * @param {object} [options]
 * @param {function} [options.logger]
 * @param {function} [options.runGit] - Custom runGitCommand (for testing)
 * @returns {Promise<void>}
 */
export async function ensureCredentialsInHelper(repoUrl, token, options = {}) {
  const { runGit = runGitCommand } = options;

  if (!token) {
    throw new Error('Token is required for git credential helper mode');
  }

  if (token.includes('\n') || token.includes('\r')) {
    throw new Error('Token contains invalid characters');
  }

  let parsed;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new Error('Credential helper mode supports only https repository urls');
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    throw new Error('Credential helper mode supports only https repository urls');
  }

  const host = parsed.hostname;

  // Serialize credential operations per host
  const existingLock = _credentialLocks.get(host);
  if (existingLock) {
    await existingLock;
  }

  if (_credentialReadyHosts.has(host)) {
    return;
  }

  const work = (async () => {
    const approvePayload = `protocol=https\nhost=${host}\nusername=oauth2\npassword=${token}\n\n`;
    const { code, stderr } = await runGit(['git', 'credential', 'approve'], {
      stdinText: approvePayload,
    });

    if (code !== 0) {
      throw new Error(
        `Unable to store credentials in helper: ${sanitizeGitOutput(stderr).slice(0, 200)}`
      );
    }

    _credentialReadyHosts.add(host);
  })();

  _credentialLocks.set(host, work.catch(() => {}));

  try {
    await work;
  } finally {
    _credentialLocks.delete(host);
  }
}

/**
 * Reset credential state (for testing).
 */
export function resetCredentialState() {
  _credentialLocks.clear();
  _credentialReadyHosts.clear();
}

/**
 * Calculate the target directory for cloning a project.
 * Preserves group structure: clonePath/group/subgroup/repo-name
 *
 * @param {object} project - Project object with name and group_path
 * @param {object} config - Config object with clonePath
 * @returns {{ repoName: string, targetPath: string }}
 */
export function buildCloneTarget(project, config) {
  const repoName =
    sanitizePathComponent(String(project.name || 'unknown-repo')) || 'unknown-repo';
  const groupPath = sanitizePathComponent(String(project.group_path || ''));
  const parts = [config.clonePath];
  if (groupPath) {
    parts.push(...groupPath.split('/'));
  }
  parts.push(repoName);
  const targetPath = resolve(...parts);
  return { repoName, targetPath };
}

/**
 * Check if a directory exists.
 * @param {string} dirPath
 * @returns {Promise<boolean>}
 */
async function directoryExists(dirPath) {
  try {
    await access(dirPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sleep for given seconds, respecting AbortSignal.
 * @param {number} seconds
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function sleep(seconds, signal) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolvePromise, seconds * 1000);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Clone or update a single repository.
 *
 * @param {object} project - Project object (name, group_path, http_url_to_repo)
 * @param {object} config - GitlabConfig object
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - AbortSignal for graceful shutdown
 * @param {function} [options.logger] - Logger function(level, message, ...args)
 * @param {function} [options.runGit] - Custom runGitCommand (for testing)
 * @param {function} [options.onResult] - Callback for progress reporting
 * @returns {Promise<{name: string, status: string, message: string}>}
 */
export async function cloneRepository(project, config, options = {}) {
  const { signal, logger = () => {}, runGit = runGitCommand } = options;
  const { repoName, targetPath } = buildCloneTarget(project, config);
  const httpsUrl = project.http_url_to_repo;

  if (signal?.aborted) {
    return { name: repoName, status: 'skipped', message: 'Shutdown requested' };
  }

  if (!httpsUrl) {
    logger('warn', 'Skipping %s: HTTPS URL is missing', repoName);
    return { name: repoName, status: 'failed', message: 'Missing HTTPS URL' };
  }

  // Path traversal check: verify target is under clone root
  const resolvedBase = resolve(config.clonePath);
  const resolvedTarget = resolve(targetPath);
  if (!resolvedTarget.startsWith(resolvedBase + sep) && resolvedTarget !== resolvedBase) {
    logger('error', 'Skipping %s: resolved path is outside clone root', repoName);
    return { name: repoName, status: 'failed', message: 'Unsafe target path' };
  }

  await mkdir(dirname(targetPath), { recursive: true });

  const exists = await directoryExists(targetPath);

  if (exists) {
    if (!config.updateExisting) {
      logger('info', 'Skipping %s: already cloned', repoName);
      return { name: repoName, status: 'skipped', message: 'Already cloned' };
    }

    if (config.gitAuthMode === 'credential_helper') {
      try {
        await ensureCredentialsInHelper(httpsUrl, config.token, { logger, runGit });
      } catch (err) {
        return { name: repoName, status: 'failed', message: err.message };
      }
    }

    logger('info', 'Updating %s with git pull --ff-only', repoName);
    const { code, stderr } = await runGit(['git', '-C', targetPath, 'pull', '--ff-only'], {
      signal,
    });

    if (code === 0) {
      return { name: repoName, status: 'updated', message: 'Updated successfully' };
    }
    return {
      name: repoName,
      status: 'failed',
      message: `Update failed: ${sanitizeGitOutput(stderr).slice(0, 200)}`,
    };
  }

  // Build clone URL
  let cloneUrl;
  try {
    if (config.gitAuthMode === 'credential_helper') {
      await ensureCredentialsInHelper(httpsUrl, config.token, { logger, runGit });
      cloneUrl = httpsUrl;
    } else {
      cloneUrl = buildAuthenticatedCloneUrl(httpsUrl, config.token || '');
    }
  } catch (err) {
    logger('error', 'Skipping %s: %s', repoName, err.message);
    return { name: repoName, status: 'failed', message: err.message };
  }

  logger('info', 'Cloning %s into %s', repoName, targetPath);

  const totalAttempts = (config.cloneRetries ?? DEFAULT_CLONE_RETRIES) + 1;
  let delay = 1;
  let lastStderr = '';

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (signal?.aborted) {
      return { name: repoName, status: 'skipped', message: 'Shutdown requested' };
    }

    const { code, stderr } = await runGit(['git', 'clone', cloneUrl, targetPath], { signal });

    if (code === 0) {
      logger('info', 'Repository %s cloned successfully', repoName);
      return { name: repoName, status: 'success', message: 'Cloned' };
    }

    lastStderr = stderr;
    logger(
      'warn',
      'Clone failed for %s on attempt %d/%d: %s',
      repoName,
      attempt,
      totalAttempts,
      sanitizeGitOutput(stderr).slice(0, 200)
    );

    // Remove partial clone directory
    try {
      await rm(targetPath, { recursive: true, force: true });
    } catch {
      // ignore removal errors
    }

    if (attempt < totalAttempts) {
      await sleep(delay, signal);
      delay = Math.min(delay * 2, RETRY_BACKOFF_MAX);
    }
  }

  return {
    name: repoName,
    status: 'failed',
    message: `Clone failed: ${sanitizeGitOutput(lastStderr).slice(0, 200)}`,
  };
}

/**
 * Clone/update all repositories with concurrency control.
 *
 * @param {Array<object>} projects - Array of project objects
 * @param {object} config - GitlabConfig object
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - AbortSignal for graceful shutdown
 * @param {function} [options.logger] - Logger function
 * @param {function} [options.runGit] - Custom runGitCommand (for testing)
 * @param {function} [options.onResult] - Callback(result) called after each repo completes
 * @returns {Promise<Array<{name: string, status: string, message: string}>>}
 */
export async function cloneAllRepositories(projects, config, options = {}) {
  const { signal, onResult } = options;
  const concurrency = config.maxConcurrency || 5;
  const results = [];
  let running = 0;
  let index = 0;

  return new Promise((resolvePromise) => {
    function scheduleNext() {
      while (running < concurrency && index < projects.length) {
        if (signal?.aborted) {
          // Mark remaining as skipped
          while (index < projects.length) {
            const project = projects[index++];
            const name =
              sanitizePathComponent(String(project.name || 'unknown-repo')) || 'unknown-repo';
            const result = { name, status: 'skipped', message: 'Shutdown requested' };
            results.push(result);
            if (onResult) onResult(result);
          }
          if (running === 0) resolvePromise(results);
          return;
        }

        const project = projects[index++];
        running++;

        cloneRepository(project, config, options).then((result) => {
          results.push(result);
          if (onResult) onResult(result);
          running--;

          if (index >= projects.length && running === 0) {
            resolvePromise(results);
          } else {
            scheduleNext();
          }
        });
      }

      if (projects.length === 0) {
        resolvePromise(results);
      }
    }

    scheduleNext();
  });
}
