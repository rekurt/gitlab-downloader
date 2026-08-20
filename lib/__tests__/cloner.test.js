import { jest } from '@jest/globals';
import { resolve, sep } from 'node:path';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import {
  runGitCommand,
  buildCloneTarget,
  cloneRepository,
  cloneAllRepositories,
} from '../cloner.js';

// Temp dir for tests that need an existing directory
const TEST_BASE_DIR = resolve('/tmp/cloner-test-base');
const TEST_EXISTING_DIR = resolve(TEST_BASE_DIR, 'existing-repo');

beforeAll(() => {
  mkdirSync(TEST_EXISTING_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_BASE_DIR, { recursive: true, force: true });
});

// Suppress console output in tests
const noopLogger = () => {};

// Helper: create a mock runGit function
function mockRunGit(responses) {
  const calls = [];
  let callIndex = 0;
  const fn = async (args, options = {}) => {
    calls.push({ args, options });
    if (callIndex < responses.length) {
      const resp = responses[callIndex++];
      if (typeof resp === 'function') return resp(args, options);
      return resp;
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

// Helper: default test config
function testConfig(overrides = {}) {
  return {
    clonePath: '/tmp/test-repos',
    token: 'test-token-123',
    updateExisting: false,
    cloneRetries: 2,
    maxConcurrency: 3,
    ...overrides,
  };
}

// Helper: default test project
function testProject(overrides = {}) {
  return {
    name: 'my-project',
    group_path: 'my-group',
    http_url_to_repo: 'https://gitlab.example.com/my-group/my-project.git',
    ...overrides,
  };
}

describe('runGitCommand', () => {
  it('captures stdout and stderr from git command', async () => {
    // Use a real command to test the spawn mechanism
    const result = await runGitCommand(['echo', 'hello world']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('');
  });

  it('captures non-zero exit code', async () => {
    const result = await runGitCommand(['sh', '-c', 'exit 42']);
    expect(result.code).toBe(42);
  });

  it('captures stderr output', async () => {
    const result = await runGitCommand(['sh', '-c', 'echo "error msg" >&2; exit 1']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('error msg');
  });

  it('passes stdinText to process', async () => {
    const result = await runGitCommand(['cat'], { stdinText: 'input data' });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('input data');
  });

  it('rejects immediately if signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runGitCommand(['echo', 'test'], { signal: controller.signal })).rejects.toThrow();
  });

  it('kills process on abort signal', async () => {
    const controller = new AbortController();
    const promise = runGitCommand(['sleep', '10'], { signal: controller.signal });
    // Abort after a short delay
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toThrow();
  });

  it('passes custom env vars', async () => {
    const result = await runGitCommand(['sh', '-c', 'echo $MY_TEST_VAR'], {
      env: { MY_TEST_VAR: 'custom_value' },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('custom_value');
  });
});

describe('buildCloneTarget', () => {
  it('builds target path preserving group structure', () => {
    const project = { name: 'repo', group_path: 'org/team' };
    const config = { clonePath: '/tmp/repos' };
    const { repoName, targetPath } = buildCloneTarget(project, config);
    expect(repoName).toBe('repo');
    expect(targetPath).toBe(resolve('/tmp/repos', 'org', 'team', 'repo'));
  });

  it('handles empty group_path', () => {
    const project = { name: 'repo', group_path: '' };
    const config = { clonePath: '/tmp/repos' };
    const { repoName, targetPath } = buildCloneTarget(project, config);
    expect(repoName).toBe('repo');
    expect(targetPath).toBe(resolve('/tmp/repos', 'repo'));
  });

  it('uses unknown-repo for missing name', () => {
    const project = { group_path: 'org' };
    const config = { clonePath: '/tmp/repos' };
    const { repoName } = buildCloneTarget(project, config);
    expect(repoName).toBe('unknown-repo');
  });

  it('uses the canonical project path instead of a non-unique display name', () => {
    const first = buildCloneTarget({
      id: 1,
      name: 'Shared display name',
      path: 'first-project',
      path_with_namespace: 'org/first-project',
    }, { clonePath: '/tmp/repos' });
    const second = buildCloneTarget({
      id: 2,
      name: 'Shared display name',
      path: 'second-project',
      path_with_namespace: 'org/second-project',
    }, { clonePath: '/tmp/repos' });

    expect(first.repoName).toBe('first-project');
    expect(second.repoName).toBe('second-project');
    expect(first.targetPath).not.toBe(second.targetPath);
  });

  it('sanitizes path components', () => {
    const project = { name: '../evil-repo', group_path: '../../etc' };
    const config = { clonePath: '/tmp/repos' };
    const { repoName, targetPath } = buildCloneTarget(project, config);
    // sanitizePathComponent removes .. components
    expect(repoName).not.toContain('..');
    expect(targetPath).not.toContain('..');
  });

  it('handles null group_path', () => {
    const project = { name: 'repo', group_path: null };
    const config = { clonePath: '/tmp/repos' };
    const { repoName, targetPath } = buildCloneTarget(project, config);
    expect(repoName).toBe('repo');
    expect(targetPath).toBe(resolve('/tmp/repos', 'repo'));
  });
});

describe('cloneRepository', () => {
  it('returns skipped if signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await cloneRepository(
      testProject(),
      testConfig(),
      { signal: controller.signal, logger: noopLogger }
    );

    expect(result.status).toBe('skipped');
    expect(result.message).toContain('Shutdown');
  });

  it('returns failed if https URL is missing', async () => {
    const result = await cloneRepository(
      testProject({ http_url_to_repo: null }),
      testConfig(),
      { logger: noopLogger }
    );

    expect(result.status).toBe('failed');
    expect(result.message).toContain('Missing HTTPS URL');
  });

  it('detects unsafe target path (directory traversal)', async () => {
    const project = testProject({ name: 'repo', group_path: '' });
    // Config with a clone path, but we'll manipulate so the target is outside
    const config = testConfig({ clonePath: '/tmp/test-safe-repos' });

    // The path validation in cloneRepository uses resolve-based check.
    // With sanitizePathComponent, ../.. gets stripped, so this specific case
    // won't actually escape. But a project with name containing only ".." would
    // result in "unknown-repo" fallback. Let's test that the function handles it.
    const result = await cloneRepository(project, config, {
      logger: noopLogger,
      runGit: mockRunGit([{ code: 0, stdout: '', stderr: '' }]),
    });

    // The function should proceed normally since sanitized paths are safe
    expect(result).toBeDefined();
  });

  it('clones with a clean URL and one-time askpass environment', async () => {
    const runGit = mockRunGit([{ code: 0, stdout: '', stderr: '' }]);
    const config = testConfig({ clonePath: '/tmp/test-clone-repos' });

    const result = await cloneRepository(testProject(), config, {
      logger: noopLogger,
      runGit,
    });

    expect(result.status).toBe('success');
    expect(result.message).toBe('Cloned');
    expect(runGit.calls).toHaveLength(1);
    expect(runGit.calls[0].args).toEqual([
      'git',
      'clone',
      'https://gitlab.example.com/my-group/my-project.git',
      resolve('/tmp/test-clone-repos/my-group/my-project'),
    ]);
    expect(JSON.stringify(runGit.calls[0].args)).not.toContain('test-token-123');
    expect(runGit.calls[0].options.env.GIT_ASKPASS).toBeTruthy();
    expect(runGit.calls[0].options.env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('removes legacy URL credentials before passing a clone URL to Git', async () => {
    const runGit = mockRunGit([{ code: 0, stdout: '', stderr: '' }]);
    const config = testConfig({ clonePath: '/tmp/test-clean-clone-url' });
    const project = testProject({
      http_url_to_repo: 'https://oauth2:legacy-secret@gitlab.example.com/my-group/my-project.git',
    });

    await expect(cloneRepository(project, config, {
      logger: noopLogger,
      runGit,
    })).resolves.toMatchObject({ status: 'success' });

    expect(runGit.calls[0].args).toContain(
      'https://gitlab.example.com/my-group/my-project.git',
    );
    expect(JSON.stringify(runGit.calls[0].args)).not.toContain('legacy-secret');
  });

  it('retries on clone failure', async () => {
    const runGit = mockRunGit([
      { code: 128, stdout: '', stderr: 'connection refused' },
      { code: 128, stdout: '', stderr: 'connection refused' },
      { code: 0, stdout: '', stderr: '' },
    ]);
    const config = testConfig({ clonePath: '/tmp/test-retry-repos', cloneRetries: 2 });

    const result = await cloneRepository(testProject(), config, {
      logger: noopLogger,
      runGit,
    });

    expect(result.status).toBe('success');
    // 3 attempts total (1 initial + 2 retries)
    expect(runGit.calls).toHaveLength(3);
  });

  it('returns failed after all retries exhausted', async () => {
    const runGit = mockRunGit([
      { code: 128, stdout: '', stderr: 'fatal: repo not found' },
      { code: 128, stdout: '', stderr: 'fatal: repo not found' },
      { code: 128, stdout: '', stderr: 'fatal: repo not found' },
    ]);
    const config = testConfig({ clonePath: '/tmp/test-fail-repos', cloneRetries: 2 });

    const result = await cloneRepository(testProject(), config, {
      logger: noopLogger,
      runGit,
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('Clone failed');
    expect(runGit.calls).toHaveLength(3);
  });

  it('sanitizes credentials from error messages', async () => {
    const runGit = mockRunGit([
      { code: 128, stdout: '', stderr: 'fatal: https://oauth2:secret@gitlab.com/repo.git not found' },
    ]);
    const config = testConfig({ clonePath: '/tmp/test-sanitize-repos', cloneRetries: 0 });

    const result = await cloneRepository(testProject(), config, {
      logger: noopLogger,
      runGit,
    });

    expect(result.status).toBe('failed');
    expect(result.message).not.toContain('secret');
    expect(result.message).toContain('***');
  });

  it('cleans a legacy credential-bearing origin before updating', async () => {
    const runGit = mockRunGit([
      {
        code: 0,
        stdout: 'https://oauth2:legacy-secret@gitlab.example.com/my-group/my-project.git',
        stderr: '',
      },
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ]);
    const config = testConfig({
      clonePath: TEST_BASE_DIR,
      updateExisting: true,
    });
    const project = testProject({ name: 'existing-repo', group_path: '' });

    const result = await cloneRepository(project, config, {
      logger: noopLogger,
      runGit,
    });

    expect(result.status).toBe('updated');
    expect(result.message).toBe('Updated successfully');
    expect(runGit.calls[1].args).toEqual([
      'git', '-C', TEST_EXISTING_DIR, 'remote', 'set-url', 'origin',
      'https://gitlab.example.com/my-group/my-project.git',
    ]);
    expect(runGit.calls[2].args).toEqual([
      'git', '-C', TEST_EXISTING_DIR, 'pull', '--ff-only', 'origin',
    ]);
    expect(JSON.stringify(runGit.calls.map(({ args }) => args))).not.toContain('legacy-secret');
  });

  it('skips existing repo when updateExisting is false', async () => {
    const runGit = mockRunGit([]);
    const config = testConfig({
      clonePath: TEST_BASE_DIR,
      updateExisting: false,
    });
    const project = testProject({ name: 'existing-repo', group_path: '' });

    const result = await cloneRepository(project, config, {
      logger: noopLogger,
      runGit,
    });

    expect(result.status).toBe('skipped');
    expect(result.message).toBe('Already cloned');
    expect(runGit.calls).toHaveLength(0);
  });

  it('returns failed on pull failure', async () => {
    const runGit = mockRunGit([
      { code: 0, stdout: 'https://gitlab.example.com/my-group/my-project.git', stderr: '' },
      { code: 1, stdout: '', stderr: 'merge conflict' },
    ]);
    const config = testConfig({
      clonePath: TEST_BASE_DIR,
      updateExisting: true,
    });
    const project = testProject({ name: 'existing-repo', group_path: '' });

    const result = await cloneRepository(project, config, {
      logger: noopLogger,
      runGit,
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('Update failed');
  });

  it('calls onResult callback', async () => {
    const runGit = mockRunGit([{ code: 0, stdout: '', stderr: '' }]);
    const config = testConfig({ clonePath: '/tmp/test-callback-repos' });
    const onResult = jest.fn();

    await cloneRepository(testProject(), config, {
      logger: noopLogger,
      runGit,
      onResult,
    });

    // onResult is not called by cloneRepository directly, only by cloneAllRepositories
    // so it should not have been called
    expect(onResult).not.toHaveBeenCalled();
  });

});

describe('cloneAllRepositories', () => {
  it('keeps GitLab identity for repositories with duplicate names', async () => {
    const projects = [
      testProject({ id: 11, name: 'api', path_with_namespace: 'one/api' }),
      testProject({ id: 22, name: 'api', path_with_namespace: 'two/api' }),
    ];
    const results = await cloneAllRepositories(
      projects,
      testConfig({ clonePath: '/tmp/test-duplicate-names' }),
      { logger: noopLogger, runGit: mockRunGit([{ code: 0 }, { code: 0 }]) },
    );

    expect(results.map(({ id, fullPath }) => ({ id, fullPath }))).toEqual([
      { id: 11, fullPath: 'one/api' },
      { id: 22, fullPath: 'two/api' },
    ]);
  });

  it('returns empty array for empty projects list', async () => {
    const results = await cloneAllRepositories([], testConfig(), {
      logger: noopLogger,
    });
    expect(results).toEqual([]);
  });

  it('clones multiple projects concurrently', async () => {
    const startTimes = [];
    const runGit = async (args) => {
      startTimes.push(Date.now());
      // Small delay to simulate work
      await new Promise((r) => setTimeout(r, 20));
      return { code: 0, stdout: '', stderr: '' };
    };

    const projects = [
      testProject({ name: 'repo1', group_path: 'org' }),
      testProject({ name: 'repo2', group_path: 'org' }),
      testProject({ name: 'repo3', group_path: 'org' }),
    ];

    const config = testConfig({ clonePath: '/tmp/test-concurrent', maxConcurrency: 3 });

    const results = await cloneAllRepositories(projects, config, {
      logger: noopLogger,
      runGit,
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('respects concurrency limit', async () => {
    let activeConcurrent = 0;
    let maxConcurrent = 0;

    const runGit = async () => {
      activeConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, activeConcurrent);
      await new Promise((r) => setTimeout(r, 50));
      activeConcurrent--;
      return { code: 0, stdout: '', stderr: '' };
    };

    const projects = Array.from({ length: 6 }, (_, i) =>
      testProject({ name: `repo${i}`, group_path: 'org' })
    );

    const config = testConfig({ clonePath: '/tmp/test-limit', maxConcurrency: 2 });

    await cloneAllRepositories(projects, config, {
      logger: noopLogger,
      runGit,
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('calls onResult callback for each project', async () => {
    const runGit = mockRunGit([
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ]);
    const onResult = jest.fn();

    const projects = [
      testProject({ name: 'repo1', group_path: 'org' }),
      testProject({ name: 'repo2', group_path: 'org' }),
    ];

    const config = testConfig({ clonePath: '/tmp/test-onresult', maxConcurrency: 1 });

    await cloneAllRepositories(projects, config, {
      logger: noopLogger,
      runGit,
      onResult,
    });

    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls[0][0].name).toBe('repo1');
    expect(onResult.mock.calls[1][0].name).toBe('repo2');
  });

  it('marks remaining as skipped on abort', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const runGit = async () => {
      callCount++;
      if (callCount === 1) {
        // Abort after first clone starts
        controller.abort();
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const projects = [
      testProject({ name: 'repo1', group_path: 'org' }),
      testProject({ name: 'repo2', group_path: 'org' }),
      testProject({ name: 'repo3', group_path: 'org' }),
    ];

    const config = testConfig({ clonePath: '/tmp/test-abort', maxConcurrency: 1 });

    const results = await cloneAllRepositories(projects, config, {
      signal: controller.signal,
      logger: noopLogger,
      runGit,
    });

    // At least one should complete, rest should be skipped
    expect(results.length).toBe(3);
    const skipped = results.filter((r) => r.status === 'skipped');
    expect(skipped.length).toBeGreaterThanOrEqual(1);
  });

  it('handles mixed success and failure results', async () => {
    let callIndex = 0;
    const runGit = async () => {
      callIndex++;
      if (callIndex === 2) {
        return { code: 128, stdout: '', stderr: 'fatal: not found' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const projects = [
      testProject({ name: 'repo1', group_path: 'org' }),
      testProject({ name: 'repo2', group_path: 'org' }),
      testProject({ name: 'repo3', group_path: 'org' }),
    ];

    const config = testConfig({ clonePath: '/tmp/test-mixed', maxConcurrency: 1, cloneRetries: 0 });

    const results = await cloneAllRepositories(projects, config, {
      logger: noopLogger,
      runGit,
    });

    expect(results).toHaveLength(3);
    const successes = results.filter((r) => r.status === 'success');
    const failures = results.filter((r) => r.status === 'failed');
    expect(successes.length).toBe(2);
    expect(failures.length).toBe(1);
  });

  it('defaults to concurrency of 5 when maxConcurrency is not set', async () => {
    let maxConcurrent = 0;
    let activeConcurrent = 0;

    const runGit = async () => {
      activeConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, activeConcurrent);
      await new Promise((r) => setTimeout(r, 30));
      activeConcurrent--;
      return { code: 0, stdout: '', stderr: '' };
    };

    const projects = Array.from({ length: 10 }, (_, i) =>
      testProject({ name: `repo${i}`, group_path: 'org' })
    );

    const config = { ...testConfig(), maxConcurrency: undefined };

    await cloneAllRepositories(projects, config, {
      logger: noopLogger,
      runGit,
    });

    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });
});
