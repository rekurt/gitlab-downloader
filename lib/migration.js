import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { runGitCommand } from './cloner.js';

/**
 * @typedef {import('./author-mapper.js').AuthorMapping} AuthorMapping
 * @typedef {import('./author-mapper.js').CommitterMapping} CommitterMapping
 * @typedef {import('./author-mapper.js').MigrationConfig} MigrationConfig
 */

/** Default timeout for filter-branch operations: 1 hour in milliseconds. */
const FILTER_BRANCH_TIMEOUT_MS = 3600 * 1000;

/**
 * Validate that a string does not contain control characters that could
 * break shell scripts (newlines, null bytes, etc.).
 *
 * @param {string} value
 * @param {string} label - Description for error messages
 */
function validateShellSafe(value, label) {
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} contains invalid control characters`);
  }
}

/**
 * Escape a string for use in a single-quoted shell argument.
 * Replaces every single quote with the sequence: '\'' (end quote, escaped quote, start quote).
 *
 * @param {string} s
 * @returns {string} - Shell-safe single-quoted string
 */
function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Check if a path contains a .git directory (is a git repo).
 *
 * @param {string} repoPath
 * @returns {Promise<boolean>}
 */
async function isGitRepo(repoPath) {
  try {
    await access(join(repoPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a bash env-filter script for git filter-branch that rewrites
 * author or committer identity based on mappings.
 *
 * @param {Record<string, AuthorMapping|CommitterMapping>} mappings
 * @param {'AUTHOR'|'COMMITTER'} envPrefix
 * @returns {string} - Bash script fragment
 */
export function createMappingScript(mappings, envPrefix) {
  const entries = Object.values(mappings);
  if (entries.length === 0) return 'true';

  const parts = [];
  let first = true;

  for (const mapping of entries) {
    const values = [
      ['original_name', mapping.original_name],
      ['original_email', mapping.original_email],
      ['new_name', mapping.new_name],
      ['new_email', mapping.new_email],
    ];
    for (const [label, val] of values) {
      if (val) validateShellSafe(val, `Mapping ${label}`);
    }

    const conditions = [];
    if (mapping.original_name) {
      conditions.push(
        `[ "$GIT_${envPrefix}_NAME" = ${shellQuote(mapping.original_name)} ]`
      );
    }
    if (mapping.original_email) {
      conditions.push(
        `[ "$GIT_${envPrefix}_EMAIL" = ${shellQuote(mapping.original_email)} ]`
      );
    }
    if (conditions.length === 0) continue;
    if (!mapping.new_name && !mapping.new_email) continue;

    const keyword = first ? 'if' : 'elif';
    const conditionStr = conditions.join(' && ');
    const newName = shellQuote(mapping.new_name || mapping.original_name);
    const newEmail = shellQuote(mapping.new_email || mapping.original_email);

    parts.push(
      `${keyword} ${conditionStr}; then\n` +
      `  export GIT_${envPrefix}_NAME=${newName}\n` +
      `  export GIT_${envPrefix}_EMAIL=${newEmail}`
    );
    first = false;
  }

  if (parts.length === 0) return 'true';
  return parts.join('\n') + '\nfi';
}

/**
 * Run git filter-branch with the given env-filter script on a repository.
 *
 * @param {string} repoPath - Path to the git repository
 * @param {string} envFilterScript - Bash script for --env-filter
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - AbortSignal for cancellation
 * @param {number} [options.timeoutMs] - Timeout in ms (default: 1 hour)
 * @returns {Promise<{success: boolean, stdout: string, stderr: string}>}
 */
async function runFilterBranch(repoPath, envFilterScript, options = {}) {
  const { signal, timeoutMs = FILTER_BRANCH_TIMEOUT_MS } = options;

  // Create our own AbortController for timeout if none provided
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(new Error('filter-branch timed out')), timeoutMs);

  // If an external signal is provided, propagate its abort
  const onExternalAbort = () => ac.abort(signal.reason);
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      return { success: false, stdout: '', stderr: 'Aborted' };
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const args = [
      'git', '-C', repoPath,
      'filter-branch', '-f',
      '--env-filter', envFilterScript,
      '--', '--all',
    ];

    const result = await runGitCommand(args, { signal: ac.signal });
    return {
      success: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (err) {
    return {
      success: false,
      stdout: '',
      stderr: err.message || String(err),
    };
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ─── MigrationExecutor ─────────────────────────────────────────────

/**
 * Executes git author/committer rewriting on repositories.
 *
 * Events emitted:
 * - 'progress' (message: string) - progress updates
 * - 'error' (message: string) - error messages
 */
export class MigrationExecutor extends EventEmitter {
  /**
   * @param {MigrationConfig} config
   */
  constructor(config) {
    super();
    this.config = config;
    this.sourcePath = config.source_repos_path;
    // Prevent unhandled 'error' event from crashing the process
    this.on('error', () => {});
  }

  /**
   * Replace authors in git history using filter-branch.
   *
   * @param {string} repoPath
   * @param {Record<string, AuthorMapping>} [authorMappings]
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @param {(msg: string) => void} [options.onProgress]
   * @returns {Promise<boolean>}
   */
  async replaceAuthors(repoPath, authorMappings, options = {}) {
    const mappings = authorMappings ?? this.config.author_mappings;
    if (!mappings || Object.keys(mappings).length === 0) {
      return true;
    }
    if (!(await isGitRepo(repoPath))) {
      this._emitError(`Not a git repository: ${repoPath}`);
      return false;
    }
    const script = createMappingScript(mappings, 'AUTHOR');
    this._emitProgress(`Replacing authors in ${repoPath}`, options.onProgress);

    const result = await runFilterBranch(repoPath, script, options);
    if (!result.success) {
      this._emitError(`Author replacement failed for ${repoPath}: ${result.stderr}`);
      return false;
    }
    this._emitProgress(`Author replacement complete for ${repoPath}`, options.onProgress);
    return true;
  }

  /**
   * Replace committers in git history using filter-branch.
   *
   * @param {string} repoPath
   * @param {Record<string, CommitterMapping>} [committerMappings]
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @param {(msg: string) => void} [options.onProgress]
   * @returns {Promise<boolean>}
   */
  async replaceCommitters(repoPath, committerMappings, options = {}) {
    const mappings = committerMappings ?? this.config.committer_mappings;
    if (!mappings || Object.keys(mappings).length === 0) {
      return true;
    }
    if (!(await isGitRepo(repoPath))) {
      this._emitError(`Not a git repository: ${repoPath}`);
      return false;
    }
    const script = createMappingScript(mappings, 'COMMITTER');
    this._emitProgress(`Replacing committers in ${repoPath}`, options.onProgress);

    const result = await runFilterBranch(repoPath, script, options);
    if (!result.success) {
      this._emitError(`Committer replacement failed for ${repoPath}: ${result.stderr}`);
      return false;
    }
    this._emitProgress(`Committer replacement complete for ${repoPath}`, options.onProgress);
    return true;
  }

  /**
   * Execute complete migration: rewrite both authors and committers in a single
   * filter-branch pass to preserve backup refs.
   *
   * @param {string} repoPath
   * @param {object} [options]
   * @param {Record<string, AuthorMapping>} [options.authorMappings]
   * @param {Record<string, CommitterMapping>} [options.committerMappings]
   * @param {AbortSignal} [options.signal]
   * @param {(msg: string) => void} [options.onProgress]
   * @returns {Promise<boolean>}
   */
  async migrateRepository(repoPath, options = {}) {
    const authorMappings = options.authorMappings ?? this.config.author_mappings;
    const committerMappings = options.committerMappings ?? this.config.committer_mappings;

    const hasAuthors = authorMappings && Object.keys(authorMappings).length > 0;
    const hasCommitters = committerMappings && Object.keys(committerMappings).length > 0;

    if (!hasAuthors && !hasCommitters) {
      return true;
    }

    if (!(await isGitRepo(repoPath))) {
      this._emitError(`Not a git repository: ${repoPath}`);
      return false;
    }

    // Build a combined env-filter to run in a single pass
    const authorScript = hasAuthors
      ? createMappingScript(authorMappings, 'AUTHOR')
      : 'true';
    const committerScript = hasCommitters
      ? createMappingScript(committerMappings, 'COMMITTER')
      : 'true';
    const combinedScript = `${authorScript}\n${committerScript}`;

    const repoName = repoPath.split('/').filter(Boolean).pop() || repoPath;
    this._emitProgress(`Migrating repository: ${repoName}`, options.onProgress);

    const result = await runFilterBranch(repoPath, combinedScript, options);
    if (!result.success) {
      this._emitError(`Migration failed for ${repoPath}: ${result.stderr}`);
      return false;
    }
    this._emitProgress(`Migration complete for ${repoName}`, options.onProgress);
    return true;
  }

  /**
   * Emit a progress event and call the optional callback.
   *
   * @param {string} message
   * @param {((msg: string) => void)|undefined} callback
   */
  _emitProgress(message, callback) {
    this.emit('progress', message);
    if (typeof callback === 'function') callback(message);
  }

  /**
   * Emit an error event.
   *
   * @param {string} message
   */
  _emitError(message) {
    this.emit('error', message);
  }
}
