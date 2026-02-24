import { jest } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock runGitCommand before importing migration module
const mockRunGitCommand = jest.fn();
jest.unstable_mockModule('../cloner.js', () => ({
  runGitCommand: mockRunGitCommand,
}));

const { createMappingScript, MigrationExecutor } = await import('../migration.js');

let tmpDir;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'migration-test-'));
  mockRunGitCommand.mockReset();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── helpers ────────────────────────────────────────────────────────

async function createGitRepo(name = 'test-repo') {
  const repoPath = join(tmpDir, name);
  await mkdir(repoPath, { recursive: true });
  await mkdir(join(repoPath, '.git'), { recursive: true });
  return repoPath;
}

function sampleConfig() {
  return {
    source_repos_path: '/repos',
    target_hosting_url: 'https://gitlab.example.com',
    target_token: 'secret',
    author_mappings: {
      user1: {
        original_name: 'Old Author',
        original_email: 'old@author.com',
        new_name: 'New Author',
        new_email: 'new@author.com',
      },
    },
    committer_mappings: {
      comm1: {
        original_name: 'Old Committer',
        original_email: 'old@committer.com',
        new_name: 'New Committer',
        new_email: 'new@committer.com',
      },
    },
  };
}

// ─── createMappingScript ────────────────────────────────────────────

describe('createMappingScript', () => {
  test('returns "true" for empty mappings', () => {
    expect(createMappingScript({}, 'AUTHOR')).toBe('true');
  });

  test('generates single if-block for one mapping', () => {
    const mappings = {
      user1: {
        original_name: 'Old',
        original_email: 'old@test.com',
        new_name: 'New',
        new_email: 'new@test.com',
      },
    };
    const script = createMappingScript(mappings, 'AUTHOR');
    expect(script).toContain('if');
    expect(script).toContain('$GIT_AUTHOR_NAME');
    expect(script).toContain('$GIT_AUTHOR_EMAIL');
    expect(script).toContain("'Old'");
    expect(script).toContain("'old@test.com'");
    expect(script).toContain("export GIT_AUTHOR_NAME='New'");
    expect(script).toContain("export GIT_AUTHOR_EMAIL='new@test.com'");
    expect(script).toContain('fi');
    expect(script).not.toContain('elif');
  });

  test('generates if-elif for multiple mappings', () => {
    const mappings = {
      user1: {
        original_name: 'A',
        original_email: 'a@test.com',
        new_name: 'X',
        new_email: 'x@test.com',
      },
      user2: {
        original_name: 'B',
        original_email: 'b@test.com',
        new_name: 'Y',
        new_email: 'y@test.com',
      },
    };
    const script = createMappingScript(mappings, 'COMMITTER');
    expect(script).toContain('if');
    expect(script).toContain('elif');
    expect(script).toContain('$GIT_COMMITTER_NAME');
    expect(script).toContain('$GIT_COMMITTER_EMAIL');
    expect(script).toContain('fi');
  });

  test('handles mapping with only name', () => {
    const mappings = {
      user1: {
        original_name: 'OnlyName',
        original_email: '',
        new_name: 'New',
        new_email: 'new@test.com',
      },
    };
    const script = createMappingScript(mappings, 'AUTHOR');
    expect(script).toContain('$GIT_AUTHOR_NAME');
    expect(script).not.toContain('$GIT_AUTHOR_EMAIL" =');
    expect(script).toContain('fi');
  });

  test('handles mapping with only email', () => {
    const mappings = {
      user1: {
        original_name: '',
        original_email: 'only@email.com',
        new_name: 'New',
        new_email: 'new@test.com',
      },
    };
    const script = createMappingScript(mappings, 'AUTHOR');
    expect(script).toContain('$GIT_AUTHOR_EMAIL');
    expect(script).not.toContain('$GIT_AUTHOR_NAME" =');
    expect(script).toContain('fi');
  });

  test('skips mappings with both name and email empty', () => {
    const mappings = {
      user1: {
        original_name: '',
        original_email: '',
        new_name: 'New',
        new_email: 'new@test.com',
      },
    };
    const script = createMappingScript(mappings, 'AUTHOR');
    expect(script).toBe('true');
  });

  test('escapes single quotes in values', () => {
    const mappings = {
      user1: {
        original_name: "O'Brien",
        original_email: 'ob@test.com',
        new_name: "O'Connor",
        new_email: 'oc@test.com',
      },
    };
    const script = createMappingScript(mappings, 'AUTHOR');
    expect(script).toContain("'O'\\''Brien'");
    expect(script).toContain("'O'\\''Connor'");
  });

  test('uses && to join name and email conditions', () => {
    const mappings = {
      user1: {
        original_name: 'Name',
        original_email: 'email@test.com',
        new_name: 'New',
        new_email: 'new@test.com',
      },
    };
    const script = createMappingScript(mappings, 'AUTHOR');
    expect(script).toContain('&&');
  });
});

// ─── MigrationExecutor ─────────────────────────────────────────────

describe('MigrationExecutor', () => {
  test('constructor stores config', () => {
    const config = sampleConfig();
    const executor = new MigrationExecutor(config);
    expect(executor.config).toBe(config);
    expect(executor.sourcePath).toBe('/repos');
  });

  test('is an EventEmitter', () => {
    const executor = new MigrationExecutor(sampleConfig());
    expect(typeof executor.on).toBe('function');
    expect(typeof executor.emit).toBe('function');
  });
});

// ─── replaceAuthors ─────────────────────────────────────────────────

describe('MigrationExecutor.replaceAuthors', () => {
  test('returns true when no author mappings', async () => {
    const config = { ...sampleConfig(), author_mappings: {} };
    const executor = new MigrationExecutor(config);
    const result = await executor.replaceAuthors(join(tmpDir, 'some-repo'));
    expect(result).toBe(true);
    expect(mockRunGitCommand).not.toHaveBeenCalled();
  });

  test('returns false for non-git directory', async () => {
    const repoPath = join(tmpDir, 'not-a-repo');
    await mkdir(repoPath, { recursive: true });

    const executor = new MigrationExecutor(sampleConfig());
    const errors = [];
    executor.on('error', (msg) => errors.push(msg));

    const result = await executor.replaceAuthors(repoPath);
    expect(result).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Not a git repository');
  });

  test('calls git filter-branch with author env-filter', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const executor = new MigrationExecutor(sampleConfig());
    const result = await executor.replaceAuthors(repoPath);

    expect(result).toBe(true);
    expect(mockRunGitCommand).toHaveBeenCalledTimes(1);
    const args = mockRunGitCommand.mock.calls[0][0];
    expect(args).toContain('filter-branch');
    expect(args).toContain('-f');
    expect(args).toContain('--env-filter');
    expect(args).toContain('--all');
    // Check env-filter script contains AUTHOR
    const envFilterIdx = args.indexOf('--env-filter');
    expect(args[envFilterIdx + 1]).toContain('GIT_AUTHOR_NAME');
  });

  test('uses custom mappings when provided', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const executor = new MigrationExecutor(sampleConfig());
    const customMappings = {
      custom: {
        original_name: 'Custom',
        original_email: 'custom@test.com',
        new_name: 'Replaced',
        new_email: 'replaced@test.com',
      },
    };
    await executor.replaceAuthors(repoPath, customMappings);

    const envFilterIdx = mockRunGitCommand.mock.calls[0][0].indexOf('--env-filter');
    const script = mockRunGitCommand.mock.calls[0][0][envFilterIdx + 1];
    expect(script).toContain("'Custom'");
    expect(script).toContain("'Replaced'");
  });

  test('returns false when filter-branch fails', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 1, stdout: '', stderr: 'error occurred' });

    const executor = new MigrationExecutor(sampleConfig());
    const errors = [];
    executor.on('error', (msg) => errors.push(msg));

    const result = await executor.replaceAuthors(repoPath);
    expect(result).toBe(false);
    expect(errors[0]).toContain('Author replacement failed');
  });

  test('emits progress events', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const executor = new MigrationExecutor(sampleConfig());
    const messages = [];
    executor.on('progress', (msg) => messages.push(msg));

    await executor.replaceAuthors(repoPath);
    expect(messages.length).toBe(2);
    expect(messages[0]).toContain('Replacing authors');
    expect(messages[1]).toContain('Author replacement complete');
  });

  test('calls onProgress callback', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const executor = new MigrationExecutor(sampleConfig());
    const messages = [];

    await executor.replaceAuthors(repoPath, undefined, { onProgress: (msg) => messages.push(msg) });
    expect(messages.length).toBe(2);
  });
});

// ─── replaceCommitters ──────────────────────────────────────────────

describe('MigrationExecutor.replaceCommitters', () => {
  test('returns true when no committer mappings', async () => {
    const config = { ...sampleConfig(), committer_mappings: {} };
    const executor = new MigrationExecutor(config);
    const result = await executor.replaceCommitters(join(tmpDir, 'some-repo'));
    expect(result).toBe(true);
  });

  test('calls git filter-branch with committer env-filter', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const executor = new MigrationExecutor(sampleConfig());
    const result = await executor.replaceCommitters(repoPath);

    expect(result).toBe(true);
    const envFilterIdx = mockRunGitCommand.mock.calls[0][0].indexOf('--env-filter');
    const script = mockRunGitCommand.mock.calls[0][0][envFilterIdx + 1];
    expect(script).toContain('GIT_COMMITTER_NAME');
    expect(script).toContain('GIT_COMMITTER_EMAIL');
  });

  test('returns false for non-git directory', async () => {
    const repoPath = join(tmpDir, 'not-a-repo');
    await mkdir(repoPath, { recursive: true });

    const executor = new MigrationExecutor(sampleConfig());
    executor.on('error', () => {}); // prevent unhandled error throw
    const result = await executor.replaceCommitters(repoPath);
    expect(result).toBe(false);
  });
});

// ─── migrateRepository ─────────────────────────────────────────────

describe('MigrationExecutor.migrateRepository', () => {
  test('returns true when no mappings at all', async () => {
    const config = { ...sampleConfig(), author_mappings: {}, committer_mappings: {} };
    const executor = new MigrationExecutor(config);
    const result = await executor.migrateRepository(join(tmpDir, 'any'));
    expect(result).toBe(true);
    expect(mockRunGitCommand).not.toHaveBeenCalled();
  });

  test('combines author and committer scripts into single pass', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const executor = new MigrationExecutor(sampleConfig());
    const result = await executor.migrateRepository(repoPath);

    expect(result).toBe(true);
    expect(mockRunGitCommand).toHaveBeenCalledTimes(1);
    const envFilterIdx = mockRunGitCommand.mock.calls[0][0].indexOf('--env-filter');
    const script = mockRunGitCommand.mock.calls[0][0][envFilterIdx + 1];
    expect(script).toContain('GIT_AUTHOR_NAME');
    expect(script).toContain('GIT_COMMITTER_NAME');
  });

  test('handles only author mappings', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const config = { ...sampleConfig(), committer_mappings: {} };
    const executor = new MigrationExecutor(config);
    const result = await executor.migrateRepository(repoPath);

    expect(result).toBe(true);
    const envFilterIdx = mockRunGitCommand.mock.calls[0][0].indexOf('--env-filter');
    const script = mockRunGitCommand.mock.calls[0][0][envFilterIdx + 1];
    expect(script).toContain('GIT_AUTHOR_NAME');
    expect(script).toContain('true'); // committer script is "true" (no-op)
  });

  test('handles only committer mappings', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const config = { ...sampleConfig(), author_mappings: {} };
    const executor = new MigrationExecutor(config);
    const result = await executor.migrateRepository(repoPath);

    expect(result).toBe(true);
    const envFilterIdx = mockRunGitCommand.mock.calls[0][0].indexOf('--env-filter');
    const script = mockRunGitCommand.mock.calls[0][0][envFilterIdx + 1];
    expect(script).toContain('GIT_COMMITTER_NAME');
  });

  test('returns false for non-git directory', async () => {
    const repoPath = join(tmpDir, 'not-a-repo');
    await mkdir(repoPath, { recursive: true });

    const executor = new MigrationExecutor(sampleConfig());
    executor.on('error', () => {}); // prevent unhandled error throw
    const result = await executor.migrateRepository(repoPath);
    expect(result).toBe(false);
  });

  test('returns false when filter-branch fails', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 128, stdout: '', stderr: 'fatal error' });

    const executor = new MigrationExecutor(sampleConfig());
    executor.on('error', () => {}); // prevent unhandled error throw
    const result = await executor.migrateRepository(repoPath);
    expect(result).toBe(false);
  });

  test('emits progress events with repo name', async () => {
    const repoPath = await createGitRepo('my-project');
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const executor = new MigrationExecutor(sampleConfig());
    const messages = [];
    executor.on('progress', (msg) => messages.push(msg));

    await executor.migrateRepository(repoPath);
    expect(messages[0]).toContain('my-project');
    expect(messages[1]).toContain('my-project');
  });

  test('accepts custom mappings via options', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const config = { ...sampleConfig(), author_mappings: {}, committer_mappings: {} };
    const executor = new MigrationExecutor(config);
    const customAuthors = {
      a: {
        original_name: 'CustomA',
        original_email: 'ca@test.com',
        new_name: 'NewA',
        new_email: 'na@test.com',
      },
    };
    const result = await executor.migrateRepository(repoPath, { authorMappings: customAuthors });

    expect(result).toBe(true);
    const envFilterIdx = mockRunGitCommand.mock.calls[0][0].indexOf('--env-filter');
    const script = mockRunGitCommand.mock.calls[0][0][envFilterIdx + 1];
    expect(script).toContain("'CustomA'");
  });

  test('passes signal to runGitCommand', async () => {
    const repoPath = await createGitRepo();
    const ac = new AbortController();
    mockRunGitCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const executor = new MigrationExecutor(sampleConfig());
    await executor.migrateRepository(repoPath, { signal: ac.signal });

    const opts = mockRunGitCommand.mock.calls[0][1];
    expect(opts.signal).toBeDefined();
  });

  test('handles runGitCommand throwing', async () => {
    const repoPath = await createGitRepo();
    mockRunGitCommand.mockRejectedValue(new Error('spawn failed'));

    const executor = new MigrationExecutor(sampleConfig());
    const errors = [];
    executor.on('error', (msg) => errors.push(msg));

    const result = await executor.migrateRepository(repoPath);
    expect(result).toBe(false);
    expect(errors[0]).toContain('Migration failed');
  });
});
