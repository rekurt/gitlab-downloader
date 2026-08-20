import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildProgram,
  main,
  resolveToken,
  secureJsonWrite,
} from '../index.js';

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function command(program, ...names) {
  let current = program;
  for (const name of names) current = current.commands.find((item) => item.name() === name);
  return current;
}

function transferPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    createdAt: '2026-08-20T10:00:00.000Z',
    source: {
      url: 'https://source.example.com',
      version: '18.6.0',
      fullPath: 'team/app',
      type: 'group',
    },
    destination: {
      url: 'https://destination.example.com',
      version: '18.7.0',
      namespace: 'archive',
    },
    entities: [],
    warnings: [],
    ...overrides,
  };
}

async function temporaryRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function io() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    output: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  };
}

describe('CLI 0.2 command surface', () => {
  test('exposes only explicit clone, transfer, and rewrite-history entry points', () => {
    const program = buildProgram();
    expect(program.version()).toBe('0.2.0');
    expect(program.commands.map((item) => item.name())).toEqual([
      'clone',
      'transfer',
      'rewrite-history',
    ]);
    expect(command(program, 'transfer').commands.map((item) => item.name())).toEqual([
      'plan', 'run', 'status', 'cancel',
    ]);
  });

  test('does not expose PAT or generic credential-helper flags anywhere', () => {
    const flags = [];
    const visit = (item) => {
      flags.push(...item.options.map((option) => option.flags));
      item.commands.forEach(visit);
    };
    visit(buildProgram());
    expect(flags.join(' ')).not.toMatch(/--token|--source-token|--destination-token|git-auth-mode/);
  });
});

describe('secret handling', () => {
  test('uses side-specific environment variables and falls back to GITLAB_TOKEN', async () => {
    await expect(resolveToken('source', {
      env: { GITLAB_SOURCE_TOKEN: 'source-secret', GITLAB_TOKEN: 'fallback' },
    })).resolves.toBe('source-secret');
    await expect(resolveToken('destination', {
      env: { GITLAB_TOKEN: 'fallback' },
    })).resolves.toBe('fallback');
  });

  test('uses a hidden prompt when no token is in the environment', async () => {
    const prompts = [];
    await expect(resolveToken('destination', {
      env: {},
      isTTY: true,
      prompt: async (question) => {
        prompts.push(question);
        return 'prompted-secret';
      },
    })).resolves.toBe('prompted-secret');
    expect(prompts[0]).toMatchObject({ type: 'password', mask: '*' });
  });

  test('fails without an environment token in non-interactive mode', async () => {
    await expect(resolveToken('source', { env: {}, isTTY: false })).rejects.toThrow(
      'GITLAB_SOURCE_TOKEN or GITLAB_TOKEN',
    );
  });

  test('rejects an empty interactive token', async () => {
    await expect(resolveToken('source', {
      env: {},
      isTTY: true,
      prompt: async () => '',
    })).rejects.toThrow('non-empty');
  });
});

test('secureJsonWrite creates private JSON files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-cli-test-'));
  roots.push(root);
  const path = join(root, 'nested', 'report.json');
  await secureJsonWrite(path, { status: 'finished' });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ status: 'finished' });
  if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test('transfer plan writes a token-free versioned plan and returns JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-cli-plan-test-'));
  roots.push(root);
  const outputPath = join(root, 'plan.json');
  const stdout = [];
  const plan = transferPlan();
  const exitCode = await main([
    'node', 'gitlab-dump', 'transfer', 'plan',
    '--source-url', plan.source.url,
    '--destination-url', plan.destination.url,
    '--source-path', plan.source.fullPath,
    '--destination-namespace', plan.destination.namespace,
    '--out', outputPath,
  ], {
    env: {
      GITLAB_SOURCE_TOKEN: 'source-must-not-leak',
      GITLAB_DESTINATION_TOKEN: 'destination-must-not-leak',
    },
    output: (text) => stdout.push(text),
    error: () => {},
    core: {
      planTransfer: async (input) => {
        expect(input.source.token).toBe('source-must-not-leak');
        expect(input.destination.token).toBe('destination-must-not-leak');
        return plan;
      },
    },
  });

  expect(exitCode).toBe(0);
  const serialized = `${await readFile(outputPath, 'utf8')}${stdout.join('')}`;
  expect(serialized).not.toContain('must-not-leak');
  expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(plan);
});

describe('clone command', () => {
  test('awaits user projects and emits a dry-run preview', async () => {
    const stream = io();
    const code = await main([
      'node', 'gitlab-dump', 'clone',
      '--url', 'https://gitlab.example.com',
      '--clone-path', '/safe/output',
      '--dry-run',
    ], {
      env: { GITLAB_SOURCE_TOKEN: 'secret' },
      ...stream,
      core: {
        getUserProjects: async () => [{
          id: 17,
          name: 'app',
          path: 'app',
          path_with_namespace: 'team/app',
          http_url_to_repo: 'https://gitlab.example.com/team/app.git',
        }],
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(stream.stdout.join(''))).toMatchObject({
      status: 'preview',
      repositories: [{ id: 17, fullPath: 'team/app' }],
    });
  });

  test('uses group metadata and reports real clone failures', async () => {
    const root = await temporaryRoot('gitlab-dump-cli-clone-');
    const reportPath = join(root, 'clone-report.json');
    const stream = io();
    const fetchGroupMetadata = jest.fn().mockResolvedValue({ full_path: 'team/platform' });
    const getAllProjects = jest.fn().mockResolvedValue([{ id: 1 }]);
    const cloneAllRepositories = jest.fn().mockResolvedValue([{ id: 1, status: 'failed' }]);
    const code = await main([
      'node', 'gitlab-dump', 'clone',
      '--url', 'https://gitlab.example.com',
      '--group', 'team/platform',
      '--update',
      '--report', reportPath,
    ], {
      env: { GITLAB_TOKEN: 'secret' },
      ...stream,
      core: { fetchGroupMetadata, getAllProjects, cloneAllRepositories },
    });

    expect(code).toBe(1);
    expect(getAllProjects).toHaveBeenCalledWith(
      expect.objectContaining({ updateExisting: true }),
      'team/platform',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({ status: 'failed' });
  });

  test('returns partial when only some clone operations fail', async () => {
    const stream = io();
    const code = await main([
      'node', 'gitlab-dump', 'clone', '--url', 'https://gitlab.example.com',
    ], {
      env: { GITLAB_SOURCE_TOKEN: 'secret' },
      ...stream,
      core: {
        getUserProjects: async () => [{ id: 1 }, { id: 2 }],
        cloneAllRepositories: async () => [
          { id: 1, status: 'success' },
          { id: 2, status: 'failed', message: 'not found' },
        ],
      },
    });

    expect(code).toBe(2);
    expect(JSON.parse(stream.stdout.join(''))).toMatchObject({ status: 'partial' });
  });
});

describe('transfer run lifecycle', () => {
  test('persists token-free state, streams events, and returns partial as exit 2', async () => {
    const root = await temporaryRoot('gitlab-dump-cli-transfer-');
    const planPath = join(root, 'plan.json');
    const reportPath = join(root, 'report.json');
    await writeFile(planPath, JSON.stringify(transferPlan()));
    const stream = io();
    const executeTransfer = jest.fn(async (_plan, options) => {
      await options.onStateChange({ status: 'running', bulkImportId: 44 });
      options.onEvent({ runId: options.runId, status: 'running', phase: 'poll' });
      return { schemaVersion: 1, runId: options.runId, status: 'partial', entities: [] };
    });

    const code = await main([
      'node', 'gitlab-dump', 'transfer', 'run',
      '--plan', planPath,
      '--run-id', 'run-44',
      '--report', reportPath,
    ], {
      env: {
        XDG_STATE_HOME: root,
        GITLAB_SOURCE_TOKEN: 'source-secret',
        GITLAB_DESTINATION_TOKEN: 'destination-secret',
      },
      ...stream,
      core: { executeTransfer },
    });

    expect(code).toBe(2);
    expect(executeTransfer.mock.calls[0][1]).toMatchObject({
      runId: 'run-44',
      sourceToken: 'source-secret',
      destinationToken: 'destination-secret',
      resumeBulkImportId: null,
    });
    const state = await readFile(join(root, 'gitlab-dump', 'runs', 'run-44.json'), 'utf8');
    expect(state).toContain('"bulkImportId": 44');
    expect(state).not.toContain('"pid"');
    expect(`${state}${stream.stdout}${stream.stderr}`).not.toContain('source-secret');
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({ status: 'partial' });
  });

  test('cancels a running local operation through private state without storing a PID', async () => {
    const root = await temporaryRoot('gitlab-dump-cli-state-cancel-');
    const planPath = join(root, 'plan.json');
    const statePath = join(root, 'gitlab-dump', 'runs', 'cancel-local.json');
    await writeFile(planPath, JSON.stringify(transferPlan()));
    const env = {
      XDG_STATE_HOME: root,
      GITLAB_SOURCE_TOKEN: 'source',
      GITLAB_DESTINATION_TOKEN: 'destination',
    };
    const executeTransfer = jest.fn(async (_plan, options) => {
      await options.onStateChange({
        runId: options.runId,
        status: 'running',
        bulkImportId: null,
      });
      await new Promise((resolve) => {
        options.signal.addEventListener('abort', resolve, { once: true });
      });
      return { runId: options.runId, status: 'canceled', entities: [] };
    });
    const running = main([
      'node', 'gitlab-dump', 'transfer', 'run', '--plan', planPath, '--run-id', 'cancel-local',
    ], { env, output: () => {}, error: () => {}, core: { executeTransfer } });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await stat(statePath);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    await expect(main([
      'node', 'gitlab-dump', 'transfer', 'cancel', '--run-id', 'cancel-local',
    ], { env, output: () => {}, error: () => {} })).resolves.toBe(0);
    await expect(running).resolves.toBe(130);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    expect(state).toMatchObject({ status: 'canceled' });
    expect(state).not.toHaveProperty('pid');
  });

  test('resumes a matching bulk import and rejects state belonging to another plan', async () => {
    const root = await temporaryRoot('gitlab-dump-cli-resume-');
    const planPath = join(root, 'plan.json');
    const stateDirectory = join(root, 'gitlab-dump', 'runs');
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(planPath, JSON.stringify(transferPlan()));
    await writeFile(join(stateDirectory, 'resume-1.json'), JSON.stringify({
      sourceUrl: 'https://source.example.com',
      destinationUrl: 'https://destination.example.com',
      bulkImportId: 99,
      status: 'running',
    }));
    const executeTransfer = jest.fn().mockResolvedValue({ status: 'finished' });
    const shared = {
      env: {
        XDG_STATE_HOME: root,
        GITLAB_SOURCE_TOKEN: 'source',
        GITLAB_DESTINATION_TOKEN: 'destination',
      },
      output: () => {},
      error: () => {},
      core: { executeTransfer },
    };
    await expect(main([
      'node', 'gitlab-dump', 'transfer', 'run', '--plan', planPath, '--run-id', 'resume-1',
    ], shared)).resolves.toBe(0);
    expect(executeTransfer.mock.calls[0][1].resumeBulkImportId).toBe(99);

    await writeFile(join(stateDirectory, 'wrong-plan.json'), JSON.stringify({
      sourceUrl: 'https://other.example.com',
      destinationUrl: 'https://destination.example.com',
      status: 'running',
    }));
    await expect(main([
      'node', 'gitlab-dump', 'transfer', 'run', '--plan', planPath, '--run-id', 'wrong-plan',
    ], shared)).resolves.toBe(1);
  });

  test('refreshes remote status and cancels a recorded bulk import', async () => {
    const root = await temporaryRoot('gitlab-dump-cli-status-');
    const stateDirectory = join(root, 'gitlab-dump', 'runs');
    await mkdir(stateDirectory, { recursive: true });
    const statePath = join(stateDirectory, 'run-status.json');
    await writeFile(statePath, JSON.stringify({
      sourceUrl: 'https://source.example.com',
      destinationUrl: 'https://destination.example.com',
      bulkImportId: 77,
      status: 'running',
      pid: process.pid,
    }));
    const stream = io();
    const getBulkImport = jest.fn().mockResolvedValue({ status: 'failed' });
    const cancelBulkImport = jest.fn().mockResolvedValue({ status: 'canceled' });
    const shared = {
      env: { XDG_STATE_HOME: root, GITLAB_DESTINATION_TOKEN: 'destination' },
      ...stream,
      core: { getBulkImport, cancelBulkImport },
    };
    await expect(main([
      'node', 'gitlab-dump', 'transfer', 'status', '--run-id', 'run-status',
    ], shared)).resolves.toBe(1);
    expect(getBulkImport).toHaveBeenCalledWith(
      { url: 'https://destination.example.com', token: 'destination' },
      77,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await writeFile(statePath, JSON.stringify({
      destinationUrl: 'https://destination.example.com',
      bulkImportId: 77,
      status: 'running',
      pid: process.pid,
    }));
    await expect(main([
      'node', 'gitlab-dump', 'transfer', 'cancel', '--run-id', 'run-status',
    ], shared)).resolves.toBe(0);
    expect(cancelBulkImport).toHaveBeenCalled();
    expect(JSON.parse(await readFile(statePath, 'utf8')).status).toBe('canceled');
  });

  test('returns terminal status without an API call and validates state/run IDs', async () => {
    const root = await temporaryRoot('gitlab-dump-cli-terminal-status-');
    const stateDirectory = join(root, 'gitlab-dump', 'runs');
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(join(stateDirectory, 'canceled-1.json'), JSON.stringify({ status: 'canceled' }));
    const getBulkImport = jest.fn();
    const shared = {
      env: { XDG_STATE_HOME: root },
      output: () => {},
      error: () => {},
      core: { getBulkImport },
    };
    await expect(main([
      'node', 'gitlab-dump', 'transfer', 'status', '--run-id', 'canceled-1',
    ], shared)).resolves.toBe(130);
    expect(getBulkImport).not.toHaveBeenCalled();
    await expect(main([
      'node', 'gitlab-dump', 'transfer', 'status', '--run-id', '../invalid',
    ], shared)).resolves.toBe(1);
    await expect(main([
      'node', 'gitlab-dump', 'transfer', 'status', '--run-id', 'missing-1',
    ], shared)).resolves.toBe(1);

    await writeFile(join(stateDirectory, 'broken-1.json'), '{');
    await expect(main([
      'node', 'gitlab-dump', 'transfer', 'status', '--run-id', 'broken-1',
    ], shared)).resolves.toBe(1);
  });
});

describe('history rewrite command', () => {
  test('previews a local repository and writes a report without requesting a token', async () => {
    const root = await temporaryRoot('gitlab-dump-cli-rewrite-preview-');
    const mappingPath = join(root, 'mapping.json');
    const reportPath = join(root, 'report.json');
    await writeFile(mappingPath, JSON.stringify({ schemaVersion: 1, mappings: [] }));
    const previewHistoryRewrite = jest.fn().mockResolvedValue({
      status: 'preview', changedCommits: 2, changedRefs: ['refs/heads/main'],
    });
    const code = await main([
      'node', 'gitlab-dump', 'rewrite-history',
      '--repository', join(root, 'source.git'),
      '--mapping', mappingPath,
      '--output', join(root, 'unused.git'),
      '--dry-run',
      '--report', reportPath,
    ], {
      env: {},
      output: () => {},
      error: () => {},
      core: { previewHistoryRewrite },
    });
    expect(code).toBe(0);
    expect(previewHistoryRewrite.mock.calls[0][0].token).toBeUndefined();
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({ status: 'preview' });
  });

  test('requires interactive push confirmation and passes both side tokens', async () => {
    const root = await temporaryRoot('gitlab-dump-cli-rewrite-push-');
    const mappingPath = join(root, 'mapping.json');
    await writeFile(mappingPath, JSON.stringify({ schemaVersion: 1, mappings: [] }));
    const output = [];
    const diagnostics = [];
    const previewResult = {
      status: 'preview', changedCommits: 7, changedRefs: ['refs/heads/main', 'refs/tags/v1'],
    };
    const previewHistoryRewrite = jest.fn().mockResolvedValue(previewResult);
    const rewriteHistory = jest.fn().mockResolvedValue({ status: 'finished' });
    const code = await main([
      'node', 'gitlab-dump', 'rewrite-history',
      '--repository', 'https://source.example.com/team/app.git',
      '--mapping', mappingPath,
      '--output', join(root, 'rewritten.git'),
      '--push',
    ], {
      env: {
        GITLAB_SOURCE_TOKEN: 'source',
        GITLAB_DESTINATION_TOKEN: 'destination',
      },
      isTTY: true,
      prompt: async () => {
        expect(diagnostics.join('')).toContain('7');
        expect(diagnostics.join('')).toContain('refs/heads/main');
        return 'I UNDERSTAND THAT COMMIT SHAS WILL CHANGE';
      },
      output: (text) => output.push(text),
      error: (text) => diagnostics.push(text),
      core: { previewHistoryRewrite, rewriteHistory },
    });
    expect(code).toBe(0);
    expect(previewHistoryRewrite).toHaveBeenCalledWith(expect.objectContaining({
      repository: 'https://source.example.com/team/app.git',
      token: 'source',
    }), expect.any(Object));
    expect(previewHistoryRewrite.mock.invocationCallOrder[0])
      .toBeLessThan(rewriteHistory.mock.invocationCallOrder[0]);
    expect(rewriteHistory.mock.calls[0][0]).toMatchObject({
      token: 'source',
      destinationToken: 'destination',
      push: true,
      confirmation: 'I UNDERSTAND THAT COMMIT SHAS WILL CHANGE',
      preview: previewResult,
    });
  });

  test('returns exit 1 for a recoverable failed rewrite report', async () => {
    const root = await temporaryRoot('gitlab-dump-cli-rewrite-failed-');
    const mappingPath = join(root, 'mapping.json');
    await writeFile(mappingPath, JSON.stringify({ schemaVersion: 1, mappings: [] }));
    await expect(main([
      'node', 'gitlab-dump', 'rewrite-history',
      '--repository', join(root, 'source.git'),
      '--mapping', mappingPath,
      '--output', join(root, 'rewritten.git'),
    ], {
      env: {},
      output: () => {},
      error: () => {},
      core: { rewriteHistory: jest.fn().mockResolvedValue({
        status: 'failed', backupPath: join(root, 'before.bundle'), error: 'lease conflict',
      }) },
    })).resolves.toBe(1);
  });
});

test('reports invalid values and redacts secrets from operation failures', async () => {
  const stream = io();
  await expect(main([
    'node', 'gitlab-dump', 'clone', '--url', 'https://gitlab.example.com', '--concurrency', 'NaN',
  ], stream)).resolves.toBe(1);
  await expect(main([
    'node', 'gitlab-dump', 'clone', '--url', 'https://gitlab.example.com',
  ], {
    env: { GITLAB_SOURCE_TOKEN: 'must-not-leak' },
    ...stream,
    core: { getUserProjects: async () => { throw new Error('failure must-not-leak'); } },
  })).resolves.toBe(1);
  expect(stream.stderr.join('')).not.toContain('must-not-leak');
});

test('parses explicit numeric and project options and reports blocked plans', async () => {
  const root = await temporaryRoot('gitlab-dump-cli-parsers-');
  const plan = transferPlan({
    source: { ...transferPlan().source, type: 'project' },
    entities: [{
      id: 'project:team/app',
      type: 'project',
      sourceFullPath: 'team/app',
      destinationFullPath: 'archive/app',
      mode: 'blocked',
      reasons: ['blocked for test'],
      warnings: [],
    }],
  });
  const code = await main([
    'node', 'gitlab-dump', 'transfer', 'plan',
    '--source-url', plan.source.url,
    '--destination-url', plan.destination.url,
    '--source-path', plan.source.fullPath,
    '--source-type', 'project',
    '--destination-namespace', plan.destination.namespace,
    '--out', join(root, 'plan.json'),
  ], {
    env: { GITLAB_SOURCE_TOKEN: 'source', GITLAB_DESTINATION_TOKEN: 'destination' },
    output: () => {},
    error: () => {},
    core: { planTransfer: jest.fn().mockResolvedValue(plan) },
  });
  expect(code).toBe(2);

  await expect(main([
    'node', 'gitlab-dump', 'clone',
    '--url', 'https://gitlab.example.com',
    '--concurrency', '2', '--per-page', '50', '--timeout', '5',
    '--api-retries', '1', '--clone-retries', '1', '--dry-run',
  ], {
    env: { GITLAB_TOKEN: 'token' },
    output: () => {},
    error: () => {},
    core: { getUserProjects: jest.fn().mockResolvedValue([]) },
  })).resolves.toBe(0);
});

test('handles help, version, and missing-subcommand parse outcomes in-process', async () => {
  const stream = io();
  await expect(main(['node', 'gitlab-dump', '--help'], stream)).resolves.toBe(0);
  await expect(main(['node', 'gitlab-dump', '--version'], stream)).resolves.toBe(0);
  await expect(main(['node', 'gitlab-dump'], stream)).resolves.toBe(1);
  expect(stream.stderr.join('')).toContain('subcommand');
});
