import { spawn } from 'node:child_process';
import { mkdir, rm, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DEFAULT_CLONE_RETRIES, RETRY_BACKOFF_MAX } from './constants.js';
import {
  sanitizePathComponent,
  redactSecrets,
  stripUrlCredentials,
  isSubpath,
} from './utils.js';
import { withGitAskPass } from './git-auth.js';

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

async function withOptionalGitAuth(token, operation) {
  if (token) return withGitAskPass(token, operation);
  return operation({ GIT_TERMINAL_PROMPT: '0' });
}

async function cleanLegacyOrigin(targetPath, runGit, options) {
  const current = await runGit(['git', '-C', targetPath, 'remote', 'get-url', 'origin'], options);
  if (current.code !== 0 || !current.stdout) return;
  const cleanUrl = stripUrlCredentials(current.stdout);
  if (cleanUrl === current.stdout) return;
  const updated = await runGit(
    ['git', '-C', targetPath, 'remote', 'set-url', 'origin', cleanUrl],
    options,
  );
  if (updated.code !== 0) throw new Error('Unable to remove credentials from the origin URL');
}

/**
 * Calculate the target directory for cloning a project.
 * Preserves group structure: clonePath/namespace/repo-name
 *
 * Uses path_with_namespace (when available) as the canonical source for
 * directory structure, ensuring consistent paths regardless of how the
 * project was fetched (group mode vs user membership mode).
 *
 * @param {object} project - Project object with name, path_with_namespace, group_path
 * @param {object} config - Config object with clonePath
 * @returns {{ repoName: string, targetPath: string }}
 */
export function buildCloneTarget(project, config) {
  const pathWithNamespace = String(project.path_with_namespace || '');
  const canonicalPath = pathWithNamespace.includes('/')
    ? pathWithNamespace.slice(pathWithNamespace.lastIndexOf('/') + 1)
    : project.path;
  const repoName =
    sanitizePathComponent(String(canonicalPath || project.name || 'unknown-repo')) || 'unknown-repo';

  // Derive group path from path_with_namespace for consistency
  let groupPath;
  if (pathWithNamespace.includes('/')) {
    groupPath = sanitizePathComponent(
      pathWithNamespace.slice(0, pathWithNamespace.lastIndexOf('/'))
    );
  } else {
    groupPath = sanitizePathComponent(String(project.group_path || ''));
  }

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
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolvePromise();
    }, seconds * 1000);
    if (signal) {
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
  const httpsUrl = project.http_url_to_repo
    ? stripUrlCredentials(project.http_url_to_repo)
    : project.http_url_to_repo;

  if (signal?.aborted) {
    return { name: repoName, status: 'skipped', message: 'Shutdown requested' };
  }

  if (!httpsUrl) {
    logger('warn', 'Skipping %s: HTTPS URL is missing', repoName);
    return { name: repoName, status: 'failed', message: 'Missing HTTPS URL' };
  }

  // Path traversal check: verify target is under clone root
  if (!isSubpath(config.clonePath, targetPath)) {
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

    logger('info', 'Updating %s with git pull --ff-only', repoName);
    let update;
    try {
      update = await withOptionalGitAuth(config.token, async (env) => {
        await cleanLegacyOrigin(targetPath, runGit, { signal, env });
        return runGit(
          ['git', '-C', targetPath, 'pull', '--ff-only', 'origin'],
          { signal, env },
        );
      });
    } catch (error) {
      return {
        name: repoName,
        status: 'failed',
        message: redactSecrets(error.message, [config.token]),
      };
    }

    if (update.code === 0) {
      return { name: repoName, status: 'updated', message: 'Updated successfully' };
    }
    return {
      name: repoName,
      status: 'failed',
      message: `Update failed: ${redactSecrets(update.stderr, [config.token]).slice(0, 200)}`,
    };
  }

  logger('info', 'Cloning %s into %s', repoName, targetPath);

  const totalAttempts = (config.cloneRetries ?? DEFAULT_CLONE_RETRIES) + 1;
  let delay = 1;
  let lastStderr = '';

  try {
    const completed = await withOptionalGitAuth(config.token, async (env) => {
      for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        if (signal?.aborted) return false;
        const { code, stderr } = await runGit(
          ['git', 'clone', httpsUrl, targetPath],
          { signal, env },
        );
        if (code === 0) return true;

        lastStderr = stderr;
        logger(
          'warn',
          'Clone failed for %s on attempt %d/%d: %s',
          repoName,
          attempt,
          totalAttempts,
          redactSecrets(stderr, [config.token]).slice(0, 200),
        );
        try {
          await rm(targetPath, { recursive: true, force: true });
        } catch {
          // A failed clone may not have created a directory.
        }
        if (attempt < totalAttempts) {
          await sleep(delay, signal);
          delay = Math.min(delay * 2, RETRY_BACKOFF_MAX);
        }
      }
      return false;
    });
    if (completed) {
      logger('info', 'Repository %s cloned successfully', repoName);
      return { name: repoName, status: 'success', message: 'Cloned' };
    }
  } catch (error) {
    if (signal?.aborted) {
      return { name: repoName, status: 'skipped', message: 'Shutdown requested' };
    }
    lastStderr = error.message;
  }

  return {
    name: repoName,
    status: 'failed',
    message: `Clone failed: ${redactSecrets(lastStderr, [config.token]).slice(0, 200)}`,
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

  const identify = (project, result) => ({
    id: project.id ?? null,
    fullPath: project.path_with_namespace ?? null,
    ...result,
  });

  return new Promise((resolvePromise) => {
    function scheduleNext() {
      while (running < concurrency && index < projects.length) {
        if (signal?.aborted) {
          // Mark remaining as skipped
          while (index < projects.length) {
            const projectIndex = index;
            const project = projects[index++];
            const name =
              sanitizePathComponent(String(project.name || 'unknown-repo')) || 'unknown-repo';
            const result = identify(project, {
              name,
              status: 'skipped',
              message: 'Shutdown requested',
            });
            results[projectIndex] = result;
            if (onResult) onResult(result);
          }
          if (running === 0) resolvePromise(results);
          return;
        }

        const projectIndex = index;
        const project = projects[index++];
        running++;

        cloneRepository(project, config, options).then((cloneResult) => {
          const result = identify(project, cloneResult);
          results[projectIndex] = result;
          if (onResult) onResult(result);
          running--;

          if (index >= projects.length && running === 0) {
            resolvePromise(results);
          } else {
            scheduleNext();
          }
        }).catch((err) => {
          const result = identify(project, {
            name: project.name || 'unknown',
            status: 'failed',
            message: `Unexpected error: ${err.message}`,
          });
          results[projectIndex] = result;
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
