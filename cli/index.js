import { Command, CommanderError, InvalidArgumentError } from 'commander';
import inquirer from 'inquirer';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import {
  DEFAULT_API_RETRIES,
  DEFAULT_CLONE_PATH,
  DEFAULT_CLONE_RETRIES,
  DEFAULT_CONCURRENCY,
  DEFAULT_PER_PAGE,
  DEFAULT_TIMEOUT,
  HISTORY_REWRITE_CONFIRMATION,
  TransferPlanSchema,
  buildCloneTarget,
  cancelBulkImport,
  cloneAllRepositories,
  executeTransfer,
  fetchGroupMetadata,
  getAllProjects,
  getBulkImport,
  getUserProjects,
  parseConfig,
  planTransfer,
  previewHistoryRewrite,
  redactSecrets,
  rewriteHistory,
} from '@gitlab-dump/core';

const VERSION = '0.2.0';

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new InvalidArgumentError('Expected an integer');
  return parsed;
}

function sourceType(value) {
  if (!['group', 'project'].includes(value)) throw new InvalidArgumentError('Expected group or project');
  return value;
}

function defaultPrompt(question) {
  return inquirer.prompt([question]).then((answers) => answers[question.name]);
}

export async function resolveToken(role, options = {}) {
  const env = options.env ?? process.env;
  const sideName = role === 'destination' ? 'GITLAB_DESTINATION_TOKEN' : 'GITLAB_SOURCE_TOKEN';
  const token = env[sideName] || env.GITLAB_TOKEN;
  if (token) return token;
  const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY && process.stderr.isTTY);
  if (!isTTY) throw new Error(`${sideName} or GITLAB_TOKEN is required in non-interactive mode`);
  const prompt = options.prompt ?? defaultPrompt;
  const prompted = await prompt({
    type: 'password',
    name: 'token',
    message: `${role === 'destination' ? 'Destination' : 'Source'} GitLab PAT:`,
    mask: '*',
  });
  if (!prompted) throw new Error('A non-empty GitLab PAT is required');
  return prompted;
}

export async function secureJsonWrite(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  await rename(temporary, target);
  if (process.platform !== 'win32') await chmod(target, 0o600);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

function runStateDirectory(env = process.env) {
  const base = env.XDG_STATE_HOME || resolve(homedir(), '.local', 'state');
  return resolve(base, 'gitlab-dump', 'runs');
}

function validateRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(runId)) throw new Error('Invalid run ID');
  return runId;
}

function runStatePath(runId, env) {
  return resolve(runStateDirectory(env), `${validateRunId(runId)}.json`);
}

async function readRunState(runId, env) {
  try {
    return await readJson(runStatePath(runId, env));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Transfer ${runId} was not found`);
    throw error;
  }
}

function exitCodeForStatus(status) {
  if (status === 'partial') return 2;
  if (status === 'canceled') return 130;
  if (status === 'failed') return 1;
  return 0;
}

async function withOperationSignals(operation) {
  const controller = new AbortController();
  const abort = (signal) => controller.abort(new DOMException(`Received ${signal}`, 'AbortError'));
  const onSigint = () => abort('SIGINT');
  const onSigterm = () => abort('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    return await operation(controller.signal);
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

function cloneConfig(options, token, env) {
  return parseConfig({
    url: options.url || env.GITLAB_URL || '',
    token,
    group: options.group || env.GITLAB_GROUP || null,
    clonePath: options.clonePath || env.CLONE_PATH || DEFAULT_CLONE_PATH,
    perPage: options.perPage ?? DEFAULT_PER_PAGE,
    requestTimeout: options.timeout ?? DEFAULT_TIMEOUT,
    maxRetries: options.apiRetries ?? DEFAULT_API_RETRIES,
    cloneRetries: options.cloneRetries ?? DEFAULT_CLONE_RETRIES,
    maxConcurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    dryRun: Boolean(options.dryRun),
    updateExisting: Boolean(options.update),
  });
}

async function runCloneCommand(options, context) {
  const token = await resolveToken('source', context);
  const config = cloneConfig(options, token, context.env);
  const projects = config.group
    ? await (async () => {
        const group = await context.core.fetchGroupMetadata(config, { signal: context.signal });
        return context.core.getAllProjects(
          config,
          group.full_path || group.path || config.group,
          { signal: context.signal },
        );
      })()
    : await context.core.getUserProjects(config, { signal: context.signal });

  if (config.dryRun) {
    const preview = projects.map((project) => ({
      id: project.id,
      fullPath: project.path_with_namespace,
      ...buildCloneTarget(project, config),
    }));
    context.output(`${JSON.stringify({ status: 'preview', repositories: preview }, null, 2)}\n`);
    return 0;
  }
  const results = await context.core.cloneAllRepositories(projects, config, {
    signal: context.signal,
  });
  const failedCount = results.filter((item) => item.status === 'failed').length;
  const report = {
    schemaVersion: 1,
    status: context.signal.aborted
      ? 'canceled'
      : failedCount === results.length && results.length > 0
        ? 'failed'
        : failedCount > 0
          ? 'partial'
          : 'finished',
    repositories: results,
  };
  if (options.report) await secureJsonWrite(options.report, report);
  context.output(`${JSON.stringify(report, null, 2)}\n`);
  return exitCodeForStatus(report.status);
}

async function runPlanCommand(options, context) {
  const [sourceToken, destinationToken] = await Promise.all([
    resolveToken('source', context),
    resolveToken('destination', context),
  ]);
  const plan = await context.core.planTransfer({
    source: {
      url: options.sourceUrl,
      token: sourceToken,
      fullPath: options.sourcePath,
      type: options.sourceType,
    },
    destination: {
      url: options.destinationUrl,
      token: destinationToken,
      namespace: options.destinationNamespace,
    },
  }, { signal: context.signal });
  await secureJsonWrite(options.out, plan);
  context.output(`${JSON.stringify(plan, null, 2)}\n`);
  return plan.entities.some((entity) => entity.mode === 'blocked') ? 2 : 0;
}

async function runTransferCommand(options, context) {
  const plan = TransferPlanSchema.parse(await readJson(options.plan));
  const [sourceToken, destinationToken] = await Promise.all([
    resolveToken('source', context),
    resolveToken('destination', context),
  ]);
  const runId = validateRunId(options.runId || randomUUID());
  const statePath = runStatePath(runId, context.env);
  let previousState = null;
  if (options.runId) {
    try {
      previousState = await readRunState(runId, context.env);
      if (
        previousState.sourceUrl !== plan.source.url ||
        previousState.destinationUrl !== plan.destination.url
      ) {
        throw new Error(`Transfer ${runId} belongs to a different plan`);
      }
    } catch (error) {
      if (!error.message.includes('was not found')) throw error;
    }
  }
  const stateController = new AbortController();
  const persist = async (state) => {
    try {
      const current = await readRunState(runId, context.env);
      if (['cancel_requested', 'canceled'].includes(current.status)) {
        stateController.abort(new DOMException('Canceled', 'AbortError'));
        return;
      }
    } catch (error) {
      if (!error.message.includes('was not found')) throw error;
    }
    await secureJsonWrite(statePath, {
      schemaVersion: 1,
      ...state,
      sourceUrl: plan.source.url,
      destinationUrl: plan.destination.url,
      updatedAt: new Date().toISOString(),
    });
  };
  context.error(`${JSON.stringify({ runId, status: 'starting' })}\n`);
  const operationSignal = AbortSignal.any([context.signal, stateController.signal]);
  let monitorReading = false;
  const monitor = setInterval(async () => {
    if (monitorReading || stateController.signal.aborted) return;
    monitorReading = true;
    try {
      const current = await readRunState(runId, context.env);
      if (['cancel_requested', 'canceled'].includes(current.status)) {
        stateController.abort(new DOMException('Canceled', 'AbortError'));
      }
    } catch (error) {
      if (!error.message.includes('was not found')) stateController.abort(error);
    } finally {
      monitorReading = false;
    }
  }, 250);
  monitor.unref?.();
  let result;
  try {
    result = await context.core.executeTransfer(plan, {
      sourceToken,
      destinationToken,
      runId,
      signal: operationSignal,
      resumeBulkImportId: previousState?.bulkImportId ?? null,
      onStateChange: persist,
      onEvent: (event) => context.error(`${JSON.stringify(event)}\n`),
    });
  } finally {
    clearInterval(monitor);
  }
  if (options.report) await secureJsonWrite(options.report, result);
  context.output(`${JSON.stringify(result, null, 2)}\n`);
  return exitCodeForStatus(result.status);
}

async function runStatusCommand(options, context) {
  const state = await readRunState(options.runId, context.env);
  if (state.bulkImportId && !['finished', 'failed', 'canceled', 'partial'].includes(state.status)) {
    const token = await resolveToken('destination', context);
    const remote = await context.core.getBulkImport(
      { url: state.destinationUrl, token },
      state.bulkImportId,
      { signal: context.signal },
    );
    state.status = remote.status;
    state.updatedAt = new Date().toISOString();
    await secureJsonWrite(runStatePath(options.runId, context.env), state);
  }
  context.output(`${JSON.stringify(state, null, 2)}\n`);
  return exitCodeForStatus(state.status);
}

async function runCancelCommand(options, context) {
  const state = await readRunState(options.runId, context.env);
  if (['finished', 'failed', 'canceled', 'partial'].includes(state.status)) {
    context.output(`${JSON.stringify(state, null, 2)}\n`);
    return exitCodeForStatus(state.status);
  }
  state.status = 'cancel_requested';
  state.updatedAt = new Date().toISOString();
  await secureJsonWrite(runStatePath(options.runId, context.env), state);
  if (state.bulkImportId && !['finished', 'failed', 'canceled'].includes(state.status)) {
    const token = await resolveToken('destination', context);
    await context.core.cancelBulkImport(
      { url: state.destinationUrl, token },
      state.bulkImportId,
      { signal: context.signal },
    );
  }
  state.status = 'canceled';
  state.updatedAt = new Date().toISOString();
  await secureJsonWrite(runStatePath(options.runId, context.env), state);
  context.output(`${JSON.stringify(state, null, 2)}\n`);
  return 0;
}

async function confirmation(context) {
  const isTTY = context.isTTY ?? Boolean(process.stdin.isTTY && process.stderr.isTTY);
  if (!isTTY) throw new Error('History rewrite push requires an interactive confirmation');
  return (context.prompt ?? defaultPrompt)({
    type: 'input',
    name: 'confirmation',
    message: `Type exactly: ${HISTORY_REWRITE_CONFIRMATION}`,
  });
}

async function runRewriteCommand(options, context) {
  const mapping = await readJson(options.mapping);
  const needsToken = /^https:/i.test(options.repository);
  const token = needsToken ? await resolveToken('source', context) : undefined;
  if (options.dryRun) {
    const preview = await context.core.previewHistoryRewrite({
      repository: options.repository,
      mapping,
      token,
    }, { signal: context.signal });
    if (options.report) await secureJsonWrite(options.report, preview);
    context.output(`${JSON.stringify(preview, null, 2)}\n`);
    return 0;
  }
  let phrase;
  let preview;
  if (options.push) {
    preview = await context.core.previewHistoryRewrite({
      repository: options.repository,
      mapping,
      token,
    }, { signal: context.signal });
    context.error(`${JSON.stringify({
      ...preview,
      warning: 'Pushing rewrites commit SHAs and can break GitLab MR and pipeline links',
    }, null, 2)}\n`);
    phrase = await confirmation(context);
  }
  const destinationToken = options.push
    ? await resolveToken('destination', context)
    : undefined;
  const result = await context.core.rewriteHistory({
    repository: options.repository,
    mapping,
    output: options.output,
    backupPath: options.backup,
    token,
    destinationToken,
    push: Boolean(options.push),
    confirmation: phrase,
    preview,
  }, { signal: context.signal });
  if (options.report) await secureJsonWrite(options.report, result);
  context.output(`${JSON.stringify(result, null, 2)}\n`);
  return exitCodeForStatus(result.status);
}

function addCloneCommand(program, handler) {
  program.command('clone')
    .description('Clone or safely fast-forward repositories visible to the current PAT')
    .requiredOption('--url <url>', 'GitLab instance URL', process.env.GITLAB_URL)
    .option('--group <path>', 'Limit cloning to a group', process.env.GITLAB_GROUP)
    .option('--clone-path <path>', 'Destination directory', process.env.CLONE_PATH || DEFAULT_CLONE_PATH)
    .option('--update', 'Fast-forward existing repositories')
    .option('--dry-run', 'Print clone targets without changing the filesystem')
    .option('--concurrency <number>', 'Concurrent Git operations', integer, DEFAULT_CONCURRENCY)
    .option('--per-page <number>', 'GitLab API page size', integer, DEFAULT_PER_PAGE)
    .option('--timeout <seconds>', 'GitLab API timeout', integer, DEFAULT_TIMEOUT)
    .option('--api-retries <number>', 'Retry count for safe API reads', integer, DEFAULT_API_RETRIES)
    .option('--clone-retries <number>', 'Retry count for clone', integer, DEFAULT_CLONE_RETRIES)
    .option('--report <path>', 'Write a private JSON report')
    .action(handler);
}

function addTransferCommands(program, handlers) {
  const transfer = program.command('transfer').description('Plan and execute a GitLab transfer');
  transfer.command('plan')
    .requiredOption('--source-url <url>')
    .requiredOption('--destination-url <url>')
    .requiredOption('--source-path <path>')
    .requiredOption('--destination-namespace <path>')
    .requiredOption('--out <path>')
    .option('--source-type <type>', 'group or project', sourceType, 'group')
    .action(handlers.plan);
  transfer.command('run')
    .requiredOption('--plan <path>')
    .option('--run-id <id>')
    .option('--report <path>')
    .action(handlers.run);
  transfer.command('status')
    .requiredOption('--run-id <id>')
    .action(handlers.status);
  transfer.command('cancel')
    .requiredOption('--run-id <id>')
    .action(handlers.cancel);
}

function addRewriteCommand(program, handler) {
  program.command('rewrite-history')
    .requiredOption('--repository <url-or-path>')
    .requiredOption('--mapping <path>')
    .requiredOption('--output <path>')
    .option('--backup <path>')
    .option('--dry-run')
    .option('--push')
    .option('--report <path>')
    .action(handler);
}

export function buildProgram(handlers = {}) {
  const noop = () => 0;
  const program = new Command()
    .name('gitlab-dump')
    .description('Secure GitLab repository cloning and transfer')
    .version(VERSION)
    .showHelpAfterError();
  addCloneCommand(program, handlers.clone ?? noop);
  addTransferCommands(program, {
    plan: handlers.plan ?? noop,
    run: handlers.run ?? noop,
    status: handlers.status ?? noop,
    cancel: handlers.cancel ?? noop,
  });
  addRewriteCommand(program, handlers.rewrite ?? noop);
  program.action(() => {
    throw new Error('A subcommand is required');
  });
  return program;
}

function configureCommand(command, output) {
  command.exitOverride();
  command.configureOutput(output);
  command.commands.forEach((child) => configureCommand(child, output));
}

function defaultCore() {
  return {
    fetchGroupMetadata,
    getAllProjects,
    getUserProjects,
    cloneAllRepositories,
    planTransfer,
    executeTransfer,
    getBulkImport,
    cancelBulkImport,
    previewHistoryRewrite,
    rewriteHistory,
  };
}

export async function main(argv = process.argv, options = {}) {
  const context = {
    env: options.env ?? process.env,
    isTTY: options.isTTY,
    prompt: options.prompt,
    core: { ...defaultCore(), ...options.core },
    output: options.output ?? ((text) => process.stdout.write(text)),
    error: options.error ?? ((text) => process.stderr.write(text)),
  };
  let code = 0;
  const wrap = (operation) => async (commandOptions) => {
    try {
      code = await withOperationSignals((signal) => operation(commandOptions, {
        ...context,
        signal,
      }));
    } catch (error) {
      const secrets = [
        context.env.GITLAB_TOKEN,
        context.env.GITLAB_SOURCE_TOKEN,
        context.env.GITLAB_DESTINATION_TOKEN,
      ];
      context.error(`${redactSecrets(error.message || String(error), secrets)}\n`);
      code = error.name === 'AbortError' ? 130 : 1;
    }
  };
  const program = buildProgram({
    clone: wrap(runCloneCommand),
    plan: wrap(runPlanCommand),
    run: wrap(runTransferCommand),
    status: wrap(runStatusCommand),
    cancel: wrap(runCancelCommand),
    rewrite: wrap(runRewriteCommand),
  });
  configureCommand(program, {
    writeOut: context.output,
    writeErr: context.error,
  });
  try {
    await program.parseAsync(argv);
    return code;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return 0;
      return error.exitCode || 1;
    }
    context.error(`${redactSecrets(error.message || String(error))}\n`);
    return 1;
  }
}
