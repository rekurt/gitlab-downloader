import { Command } from 'commander';
import { mkdir } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import {
  parseConfig,
  resolveAccessToken,
  fetchGroupMetadata,
  getAllProjects,
  getUserProjects,
  buildCloneTarget,
  cloneAllRepositories,
  printSummary,
  printDryRun,
  writeJsonReport,
  MigrationExecutor,
  loadMigrationConfig as loadMigrationConfigCore,
  saveMigrationConfig as saveMigrationConfigCore,
  DEFAULT_CLONE_PATH,
  DEFAULT_PER_PAGE,
  DEFAULT_TIMEOUT,
  DEFAULT_API_RETRIES,
  DEFAULT_CLONE_RETRIES,
  DEFAULT_CONCURRENCY,
} from '@gitlab-dump/core';
import {
  showMainMenu,
  showCloneMenu,
  showMigrationWizard,
  showHistoryMenu,
  saveMigrationConfig,
  fillInteractive,
  showSuccess,
  showError,
  showInfo,
  showWarning,
} from './ui.js';

const VERSION = '0.1.0';

/**
 * Build commander program with all CLI options.
 * @returns {Command}
 */
export function buildProgram() {
  const program = new Command();

  program
    .name('gitlab-dump')
    .description('Download and clone GitLab repositories preserving directory structure')
    .version(VERSION)
    .option('--url <url>', 'GitLab instance URL', process.env.GITLAB_URL)
    .option('--token <token>', 'GitLab personal access token', process.env.GITLAB_TOKEN)
    .option('--group <group>', 'GitLab group ID or path', process.env.GITLAB_GROUP)
    .option('--clone-path <path>', 'Directory for cloned repositories', process.env.CLONE_PATH || DEFAULT_CLONE_PATH)
    .option('--dry-run', 'Preview operations without executing', false)
    .option('--update', 'Update existing repositories with git pull', false)
    .option('--interactive', 'Prompt for missing configuration values', false)
    .option('--interactive-menu', 'Launch rich interactive menu', false)
    .option('--concurrency <n>', 'Maximum concurrent clone operations', (v) => parseInt(v, 10), parseInt(process.env.MAX_CONCURRENCY, 10) || DEFAULT_CONCURRENCY)
    .option('--per-page <n>', 'Items per API page', (v) => parseInt(v, 10), parseInt(process.env.PER_PAGE, 10) || DEFAULT_PER_PAGE)
    .option('--timeout <seconds>', 'API request timeout in seconds', (v) => parseInt(v, 10), parseInt(process.env.REQUEST_TIMEOUT, 10) || DEFAULT_TIMEOUT)
    .option('--api-retries <n>', 'Number of API retry attempts', (v) => parseInt(v, 10), parseInt(process.env.MAX_RETRIES, 10) || DEFAULT_API_RETRIES)
    .option('--clone-retries <n>', 'Number of clone retry attempts', (v) => parseInt(v, 10), parseInt(process.env.CLONE_RETRIES, 10) || DEFAULT_CLONE_RETRIES)
    .option('--auth-method <method>', 'Authentication method (token|oauth)', process.env.AUTH_METHOD || 'oauth')
    .option('--git-auth-mode <mode>', 'Git credential mode (url|credential_helper)', process.env.GIT_AUTH_MODE || 'url')
    .option('--oauth-client-id <id>', 'OAuth application client ID', process.env.GITLAB_OAUTH_CLIENT_ID)
    .option('--oauth-client-secret <secret>', 'OAuth application client secret', process.env.GITLAB_OAUTH_CLIENT_SECRET)
    .option('--oauth-scope <scope>', 'OAuth scopes', process.env.GITLAB_OAUTH_SCOPE || 'read_api read_repository')
    .option('--log-level <level>', 'Logging level', process.env.LOG_LEVEL || 'INFO')
    .option('--report-json <path>', 'Write JSON report to file', process.env.REPORT_JSON);

  return program;
}

/**
 * Convert commander options to config object matching GitlabConfigSchema.
 * @param {object} opts - Commander parsed options
 * @returns {object}
 */
export function optsToConfig(opts) {
  return {
    url: opts.url || '',
    token: opts.token || null,
    group: opts.group || null,
    clonePath: opts.clonePath || DEFAULT_CLONE_PATH,
    perPage: opts.perPage || DEFAULT_PER_PAGE,
    requestTimeout: opts.timeout || DEFAULT_TIMEOUT,
    maxRetries: opts.apiRetries || DEFAULT_API_RETRIES,
    cloneRetries: opts.cloneRetries || DEFAULT_CLONE_RETRIES,
    maxConcurrency: opts.concurrency || DEFAULT_CONCURRENCY,
    dryRun: opts.dryRun || false,
    updateExisting: opts.update || false,
    logLevel: opts.logLevel || 'INFO',
    logFile: null,
    interactive: opts.interactive || false,
    interactiveMenu: opts.interactiveMenu || false,
    reportJson: opts.reportJson || null,
    authMethod: opts.authMethod || 'oauth',
    gitAuthMode: opts.gitAuthMode || 'url',
    oauthClientId: opts.oauthClientId || null,
    oauthClientSecret: opts.oauthClientSecret || null,
    oauthScope: opts.oauthScope || 'read_api read_repository',
  };
}

/**
 * Find git repositories recursively under a base directory.
 * @param {string} basePath
 * @param {number} [maxDepth=10]
 * @returns {string[]}
 */
export function findGitRepos(basePath, maxDepth = 10) {
  const repos = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    try {
      if (existsSync(join(dir, '.git'))) {
        repos.push(dir);
        return;
      }
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const full = join(dir, entry.name);
        if (existsSync(join(full, '.git'))) {
          repos.push(full);
        } else {
          walk(full, depth + 1);
        }
      }
    } catch {
      // Permission errors or broken symlinks - skip
    }
  }

  walk(basePath, 0);
  return repos;
}

/**
 * Run the clone workflow.
 * @param {object} config - Validated config
 * @returns {Promise<number>} - Exit code
 */
export async function runClone(config) {
  try {
    const accessToken = await resolveAccessToken(config);
    const updatedConfig = { ...config, token: accessToken };

    await mkdir(updatedConfig.clonePath, { recursive: true });

    showInfo('Fetching repository list...');

    let projects;
    if (updatedConfig.group) {
      const groupMeta = await fetchGroupMetadata(updatedConfig);
      const rootFullPath =
        groupMeta.full_path || groupMeta.path || String(updatedConfig.group);
      projects = await getAllProjects(updatedConfig, rootFullPath);
    } else {
      projects = await getUserProjects(updatedConfig);
    }

    showInfo(`Found ${projects.length} repositories`);

    if (updatedConfig.dryRun) {
      printDryRun(projects, updatedConfig, buildCloneTarget);
      return 0;
    }

    showInfo('Starting clone...');
    const ac = new AbortController();

    process.once('SIGINT', () => {
      showWarning('Shutdown signal received. Stopping new clones...');
      ac.abort();
    });
    process.once('SIGTERM', () => ac.abort());

    const results = await cloneAllRepositories(projects, updatedConfig, ac.signal);
    const hasFailed = printSummary(results);

    if (updatedConfig.reportJson) {
      await writeJsonReport(updatedConfig.reportJson, updatedConfig, projects.length, results);
      showSuccess(`JSON report written to ${updatedConfig.reportJson}`);
    }

    return hasFailed ? 1 : 0;
  } catch (err) {
    showError(`Clone failed: ${err.message}`);
    return 1;
  }
}

/**
 * Run interactive menu loop.
 * @param {object} config - Base config
 * @returns {Promise<number>}
 */
export async function runInteractiveMenu(config) {
  while (true) {
    const choice = await showMainMenu();

    if (choice === 'exit') break;

    if (choice === 'clone') {
      const cloneConfig = await showCloneMenu();
      if (cloneConfig) {
        const updated = parseConfig({
          ...config,
          url: cloneConfig.url.replace(/\/+$/, ''),
          token: cloneConfig.token,
          authMethod: 'token',
          group: cloneConfig.group,
          clonePath: cloneConfig.clonePath,
        });
        await runClone(updated);
      }
    } else if (choice === 'migrate') {
      const migrationConfig = await showMigrationWizard();
      if (migrationConfig) {
        const executor = new MigrationExecutor(migrationConfig);
        executor.on('error', (msg) => showError(msg));
        executor.on('progress', (msg) => showInfo(msg));

        const repos = findGitRepos(migrationConfig.source_repos_path);
        let succeeded = 0;
        let failed = 0;

        for (const repoDir of repos) {
          const repoName = repoDir.split('/').filter(Boolean).pop() || repoDir;
          showInfo(`Migrating ${repoName}...`);
          const ok = await executor.migrateRepository(repoDir);
          if (ok) {
            succeeded++;
          } else {
            failed++;
          }
        }

        showInfo(`Migration complete: ${succeeded} succeeded, ${failed} failed out of ${repos.length} repositories`);

        await saveMigrationConfig(
          migrationConfig,
          saveMigrationConfigCore,
          migrationConfig.source_repos_path
        );
      }
    } else if (choice === 'history') {
      await showHistoryMenu(loadMigrationConfigCore);
    }
  }

  return 0;
}

/**
 * Validate config for clone mode - checks required fields.
 * @param {object} config
 * @returns {string|null} - Error message or null if valid
 */
export function validateCloneConfig(config) {
  if (!config.url) {
    return 'GitLab URL is required. Use --url or set GITLAB_URL env variable.';
  }
  if (config.authMethod === 'token' && !config.token) {
    return 'GitLab token is required for token auth. Use --token or set GITLAB_TOKEN env variable.';
  }
  if (config.authMethod === 'oauth' && !config.oauthClientId) {
    return 'OAuth client ID is required for OAuth auth. Use --oauth-client-id or set GITLAB_OAUTH_CLIENT_ID env variable.';
  }
  return null;
}

/**
 * Main CLI entry point.
 * @param {string[]} [argv] - Command line arguments
 * @returns {Promise<number>} - Exit code
 */
export async function main(argv) {
  dotenv.config();

  const program = buildProgram();
  program.parse(argv || process.argv);
  const opts = program.opts();

  const rawConfig = optsToConfig(opts);

  // Interactive menu mode
  if (opts.interactiveMenu) {
    const config = parseConfig({ ...rawConfig, url: rawConfig.url || 'https://gitlab.com' });
    return runInteractiveMenu(config);
  }

  // Interactive mode - fill missing config via prompts
  if (opts.interactive) {
    const filled = await fillInteractive(rawConfig);
    const config = parseConfig(filled);
    return runClone(config);
  }

  // Standard clone mode - validate required fields
  const validationError = validateCloneConfig(rawConfig);
  if (validationError) {
    showError(validationError);
    return 1;
  }

  const config = parseConfig(rawConfig);
  return runClone(config);
}

