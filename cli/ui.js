import chalk from 'chalk';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Dynamically import inquirer (ESM only, lazy to keep non-interactive mode fast).
 * @returns {Promise<import('inquirer')>}
 */
let _inquirer;
async function getInquirer() {
  if (!_inquirer) {
    _inquirer = (await import('inquirer')).default;
  }
  return _inquirer;
}

/**
 * Show success message.
 * @param {string} message
 */
export function showSuccess(message) {
  console.log(chalk.green(`\n✓ ${message}`));
}

/**
 * Show error message.
 * @param {string} message
 */
export function showError(message) {
  console.error(chalk.red(`\n✗ ${message}`));
}

/**
 * Show info message.
 * @param {string} message
 */
export function showInfo(message) {
  console.log(chalk.cyan(`\nℹ ${message}`));
}

/**
 * Show warning message.
 * @param {string} message
 */
export function showWarning(message) {
  console.log(chalk.yellow(`\n⚠ ${message}`));
}

/**
 * Display the main interactive menu.
 * @returns {Promise<'clone'|'migrate'|'history'|'exit'>}
 */
export async function showMainMenu() {
  const inquirer = await getInquirer();

  console.log('');
  console.log(chalk.cyan.bold('gitlab-dump') + ' - Repository Manager');
  console.log('');

  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'Select an option',
      choices: [
        { name: '1. Clone repositories', value: 'clone' },
        { name: '2. Migrate repositories', value: 'migrate' },
        { name: '3. View history', value: 'history' },
        { name: '4. Exit', value: 'exit' },
      ],
    },
  ]);

  return choice;
}

/**
 * Show clone configuration menu.
 * @returns {Promise<{url: string, token: string, group: string|null, clonePath: string}>}
 */
export async function showCloneMenu() {
  const inquirer = await getInquirer();

  console.log('');
  console.log(chalk.cyan.bold('Clone Repositories'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'GitLab URL',
      validate: (v) => (v.trim() ? true : 'URL is required'),
    },
    {
      type: 'password',
      name: 'token',
      message: 'GitLab token',
      mask: '*',
      validate: (v) => (v.trim() ? true : 'Token is required'),
    },
    {
      type: 'input',
      name: 'group',
      message: 'Group or user (leave empty for all accessible repos)',
      default: '',
    },
    {
      type: 'input',
      name: 'clonePath',
      message: 'Clone path',
      default: resolve(homedir(), 'repositories'),
    },
  ]);

  return {
    url: answers.url.trim(),
    token: answers.token.trim(),
    group: answers.group.trim() || null,
    clonePath: answers.clonePath.trim(),
  };
}

/**
 * Show migration wizard for interactive setup.
 * @returns {Promise<import('@gitlab-dump/core').MigrationConfig|null>}
 */
export async function showMigrationWizard() {
  const inquirer = await getInquirer();

  console.log('');
  console.log(chalk.cyan.bold('Migration Wizard'));

  // Step 1: Source repos path
  const { sourcePath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'sourcePath',
      message: 'Source repositories path',
      validate: (v) => {
        if (!v.trim()) return 'Path is required';
        if (!existsSync(v.trim())) return `Path does not exist: ${v.trim()}`;
        return true;
      },
    },
  ]);

  // Step 2: Target hosting
  const { targetUrl, targetToken } = await inquirer.prompt([
    {
      type: 'input',
      name: 'targetUrl',
      message: 'Target GitLab/Git hosting URL',
      validate: (v) => (v.trim() ? true : 'URL is required'),
    },
    {
      type: 'password',
      name: 'targetToken',
      message: 'Target hosting token',
      mask: '*',
    },
  ]);

  // Step 3: Author mappings
  const authorMappings = await configureMappings(inquirer, 'author');

  // Step 4: Committer mappings
  const committerMappings = await configureMappings(inquirer, 'committer');

  // Step 5: Preview
  previewMigrationConfig(sourcePath, targetUrl, authorMappings, committerMappings);

  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Proceed with this configuration?',
      default: true,
    },
  ]);

  if (!proceed) {
    showWarning('Migration cancelled.');
    return null;
  }

  return {
    source_repos_path: sourcePath.trim(),
    target_hosting_url: targetUrl.trim(),
    target_token: targetToken.trim(),
    author_mappings: authorMappings,
    committer_mappings: committerMappings,
  };
}

/**
 * Configure author or committer mappings interactively.
 * @param {import('inquirer')} inquirer
 * @param {'author'|'committer'} type
 * @returns {Promise<Record<string, {original_name: string, original_email: string, new_name: string, new_email: string}>>}
 */
async function configureMappings(inquirer, type) {
  console.log('');
  console.log(chalk.cyan(`Configure ${type} mappings`));

  const mappings = {};
  let num = 1;

  while (true) {
    const { addMapping } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addMapping',
        message: `Add ${type} mapping #${num}?`,
        default: num === 1,
      },
    ]);

    if (!addMapping) break;

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'originalEmail',
        message: 'Original email',
        validate: (v) => (v.trim() ? true : 'Email is required'),
      },
      {
        type: 'input',
        name: 'originalName',
        message: 'Original name (optional)',
        default: '',
      },
      {
        type: 'input',
        name: 'newEmail',
        message: 'New email',
        validate: (v) => (v.trim() ? true : 'Email is required'),
      },
      {
        type: 'input',
        name: 'newName',
        message: 'New name (optional)',
        default: '',
      },
    ]);

    mappings[`mapping_${num}`] = {
      original_name: answers.originalName.trim(),
      original_email: answers.originalEmail.trim(),
      new_name: answers.newName.trim(),
      new_email: answers.newEmail.trim(),
    };
    num++;
  }

  return mappings;
}

/**
 * Preview migration configuration.
 * @param {string} sourcePath
 * @param {string} targetUrl
 * @param {Record<string, object>} authorMappings
 * @param {Record<string, object>} committerMappings
 */
function previewMigrationConfig(sourcePath, targetUrl, authorMappings, committerMappings) {
  console.log('');
  console.log(chalk.cyan.bold('Migration Configuration Preview'));
  console.log(chalk.cyan('Source Path:    ') + sourcePath);
  console.log(chalk.cyan('Target URL:     ') + targetUrl);
  console.log(chalk.cyan('Author Mappings:    ') + Object.keys(authorMappings).length);
  console.log(chalk.cyan('Committer Mappings: ') + Object.keys(committerMappings).length);

  if (Object.keys(authorMappings).length > 0) {
    console.log('');
    console.log(chalk.bold('Author Mappings:'));
    for (const m of Object.values(authorMappings)) {
      console.log(`  ${chalk.yellow(m.original_email)} → ${chalk.cyan(m.new_email)}`);
    }
  }

  if (Object.keys(committerMappings).length > 0) {
    console.log('');
    console.log(chalk.bold('Committer Mappings:'));
    for (const m of Object.values(committerMappings)) {
      console.log(`  ${chalk.yellow(m.original_email)} → ${chalk.cyan(m.new_email)}`);
    }
  }
}

/**
 * Show history view menu.
 * @param {Function} loadMigrationConfig - from @gitlab-dump/core
 * @returns {Promise<string|null>}
 */
export async function showHistoryMenu(loadMigrationConfig) {
  const inquirer = await getInquirer();

  console.log('');
  console.log(chalk.cyan.bold('View Migration History'));

  const { configPath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'configPath',
      message: 'Migration config file path (JSON/YAML)',
      validate: (v) => {
        if (!v.trim()) return 'Path is required';
        if (!existsSync(v.trim())) return `File not found: ${v.trim()}`;
        return true;
      },
    },
  ]);

  try {
    const config = await loadMigrationConfig(configPath.trim());

    console.log('');
    console.log(chalk.cyan.bold('Loaded Migration Configuration'));
    console.log(chalk.cyan('Source:     ') + config.source_repos_path);
    console.log(chalk.cyan('Target:     ') + config.target_hosting_url);
    console.log(
      chalk.cyan('Author Mappings:    ') +
        Object.keys(config.author_mappings || {}).length
    );
    console.log(
      chalk.cyan('Committer Mappings: ') +
        Object.keys(config.committer_mappings || {}).length
    );

    return configPath.trim();
  } catch (err) {
    showError(`Failed to load config: ${err.message}`);
    return null;
  }
}

/**
 * Save migration configuration to file.
 * @param {object} config - Migration configuration
 * @param {Function} saveMigrationConfigFn - from @gitlab-dump/core
 * @param {string|null} defaultPath - Default directory for config file
 * @returns {Promise<string|null>}
 */
export async function saveMigrationConfig(config, saveMigrationConfigFn, defaultPath) {
  const inquirer = await getInquirer();

  const { format } = await inquirer.prompt([
    {
      type: 'list',
      name: 'format',
      message: 'Config file format',
      choices: ['json', 'yaml'],
      default: 'json',
    },
  ]);

  const ext = format === 'json' ? '.json' : '.yaml';
  const defaultName = `migration_config${ext}`;
  const defaultFullPath = defaultPath
    ? resolve(defaultPath, defaultName)
    : defaultName;

  const { filePath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'filePath',
      message: 'Config file path',
      default: defaultFullPath,
    },
  ]);

  try {
    await saveMigrationConfigFn(filePath.trim(), config);
    showSuccess(`Configuration saved to ${filePath.trim()}`);
    return filePath.trim();
  } catch (err) {
    showError(`Error saving configuration: ${err.message}`);
    return null;
  }
}

/**
 * Prompt user for missing configuration values (interactive mode).
 * @param {object} config - Current config (may have missing values)
 * @returns {Promise<object>} - Updated config with filled-in values
 */
export async function fillInteractive(config) {
  const inquirer = await getInquirer();
  const updates = {};

  if (!config.url) {
    const { url } = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'GitLab URL',
        default: 'https://gitlab.com',
        validate: (v) => (v.trim() ? true : 'URL is required'),
      },
    ]);
    updates.url = url.trim();
  }

  const { authMethod } = await inquirer.prompt([
    {
      type: 'list',
      name: 'authMethod',
      message: 'Authentication method',
      choices: ['token', 'oauth'],
      default: config.authMethod || 'oauth',
    },
  ]);
  updates.authMethod = authMethod;

  if (authMethod === 'token' && !config.token) {
    const { token } = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: 'GitLab token',
        mask: '*',
        validate: (v) => (v.trim() ? true : 'Token is required'),
      },
    ]);
    updates.token = token.trim();
  } else if (authMethod === 'oauth') {
    if (!config.oauthClientId) {
      const { oauthClientId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'oauthClientId',
          message: 'OAuth client ID',
          validate: (v) => (v.trim() ? true : 'Client ID is required'),
        },
      ]);
      updates.oauthClientId = oauthClientId.trim();
    }
    const { oauthClientSecret } = await inquirer.prompt([
      {
        type: 'password',
        name: 'oauthClientSecret',
        message: 'OAuth client secret (optional)',
        mask: '*',
        default: config.oauthClientSecret || '',
      },
    ]);
    if (oauthClientSecret.trim()) {
      updates.oauthClientSecret = oauthClientSecret.trim();
    }
  }

  const { gitAuthMode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'gitAuthMode',
      message: 'Git auth mode',
      choices: ['url', 'credential_helper'],
      default: config.gitAuthMode || 'url',
    },
  ]);
  updates.gitAuthMode = gitAuthMode;

  if (!config.group) {
    const { group } = await inquirer.prompt([
      {
        type: 'input',
        name: 'group',
        message: 'Group (leave empty for all accessible repos)',
        default: '',
      },
    ]);
    if (group.trim()) updates.group = group.trim();
  }

  const { clonePath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'clonePath',
      message: 'Clone path',
      default: config.clonePath || 'repositories',
    },
  ]);
  updates.clonePath = clonePath.trim();

  const { concurrency } = await inquirer.prompt([
    {
      type: 'number',
      name: 'concurrency',
      message: 'Max concurrency (1-50)',
      default: config.maxConcurrency || 5,
      validate: (v) => (v >= 1 && v <= 50 ? true : 'Must be between 1 and 50'),
    },
  ]);
  updates.maxConcurrency = concurrency;

  const { updateExisting } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'updateExisting',
      message: 'Update existing repositories?',
      default: config.updateExisting || false,
    },
  ]);
  updates.updateExisting = updateExisting;

  const { dryRun } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'dryRun',
      message: 'Dry run (preview only)?',
      default: config.dryRun || false,
    },
  ]);
  updates.dryRun = dryRun;

  return { ...config, ...updates };
}
