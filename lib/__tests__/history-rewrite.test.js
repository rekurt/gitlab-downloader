import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HISTORY_REWRITE_CONFIRMATION,
  createMailmap,
  previewHistoryRewrite,
  rewriteHistory,
  validateHistoryMapping,
} from '../history-rewrite.js';
import { runGitCommand } from '../cloner.js';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function mapping() {
  return {
    schemaVersion: 1,
    mappings: [
      {
        match: { name: 'Old User', email: 'old@example.com' },
        replace: { name: 'New User', email: 'new@example.com' },
      },
    ],
  };
}

function rewritePreview(refs, changedRefs, changedCommits = 0) {
  const serialized = Object.entries(refs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, sha]) => `${name}\0${sha}\n`)
    .join('');
  return {
    status: 'preview',
    createdAt: new Date().toISOString(),
    sourceFingerprint: createHash('sha256').update(serialized).digest('hex'),
    changedRefs,
    changedCommits,
  };
}

describe('history mapping schema', () => {
  test('rejects unknown fields, duplicate match emails, and control characters', () => {
    expect(() => validateHistoryMapping({ ...mapping(), token: 'secret' })).toThrow();
    expect(() => validateHistoryMapping({
      schemaVersion: 1,
      mappings: [mapping().mappings[0], {
        match: { email: 'OLD@example.com' },
        replace: { email: 'other@example.com' },
      }],
    })).toThrow('Duplicate or ambiguous mapping');
    expect(() => validateHistoryMapping({
      schemaVersion: 1,
      mappings: [{
        match: { email: 'old@example.com' },
        replace: { name: 'Bad\nName', email: 'new@example.com' },
      }],
    })).toThrow();
  });

  test('generates a deterministic git-filter-repo mailmap', () => {
    expect(createMailmap(mapping())).toBe(
      'New User <new@example.com> Old User <old@example.com>\n',
    );
  });

  test('supports email-only identity mappings', () => {
    expect(createMailmap({
      schemaVersion: 1,
      mappings: [{
        match: { email: 'old@example.com' },
        replace: { email: 'new@example.com' },
      }],
    })).toBe('<new@example.com> <old@example.com>\n');
  });
});

describe('previewHistoryRewrite', () => {
  test('uses a disposable credential-free mirror and reports changed commits/refs', async () => {
    let refReads = 0;
    let commitReads = 0;
    const calls = [];
    const runGit = async (args) => {
      calls.push(args);
      if (args.includes('for-each-ref')) {
        refReads += 1;
        return { code: 0, stdout: `refs/heads/main ${refReads === 1 ? 'a' : 'b'}`, stderr: '' };
      }
      if (args.includes('rev-list')) {
        commitReads += 1;
        return { code: 0, stdout: commitReads === 1 ? 'a' : 'b', stderr: '' };
      }
      return { code: 0, stdout: 'ok', stderr: '' };
    };
    const result = await previewHistoryRewrite({
      repository: 'https://oauth2:legacy-secret@gitlab.example.com/team/app.git',
      token: 'runtime-secret',
      mapping: mapping(),
    }, { runGit });
    expect(result).toMatchObject({
      status: 'preview',
      changedRefs: ['refs/heads/main'],
      changedCommits: 1,
    });
    expect(result.createdAt).toEqual(expect.any(String));
    expect(result.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(calls)).not.toContain('legacy-secret');
    expect(JSON.stringify(calls)).not.toContain('runtime-secret');
  });

  test('requires git-filter-repo before cloning', async () => {
    const runGit = async () => ({ code: 1, stdout: '', stderr: 'missing' });
    await expect(previewHistoryRewrite({
      repository: '/safe/source.git',
      mapping: mapping(),
    }, { runGit })).rejects.toThrow('git-filter-repo is required');
  });
});

describe('rewriteHistory', () => {
  test('creates a bundle that restores the exact pre-rewrite refs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-rewrite-bundle-test-'));
    roots.push(root);
    const source = join(root, 'source.git');
    const work = join(root, 'work');
    const output = join(root, 'rewritten.git');
    const backupPath = join(root, 'before.bundle');
    const restored = join(root, 'restored.git');
    const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    git(['init', '--bare', source]);
    git(['init', work]);
    git(['-C', work, 'config', 'user.name', 'Old User']);
    git(['-C', work, 'config', 'user.email', 'old@example.com']);
    await writeFile(join(work, 'README.md'), 'before rewrite\n');
    git(['-C', work, 'add', 'README.md']);
    git(['-C', work, 'commit', '-m', 'initial']);
    git(['-C', work, 'branch', '-M', 'main']);
    git(['-C', work, 'push', source, 'main']);
    const original = git(['--git-dir', source, 'rev-parse', 'refs/heads/main']);

    const runGit = (args, options) => {
      if (args[1] === 'filter-repo' || args.includes('--mailmap')) {
        return Promise.resolve({ code: 0, stdout: 'test filter-repo', stderr: '' });
      }
      return runGitCommand(args, options);
    };
    await rewriteHistory({ repository: source, mapping: mapping(), output, backupPath }, { runGit });
    git(['clone', '--mirror', backupPath, restored]);

    expect(git(['--git-dir', restored, 'rev-parse', 'refs/heads/main'])).toBe(original);
  }, 30_000);

  test('clones a mirror, creates a bundle, invokes filter-repo, and reports changed refs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-rewrite-test-'));
    roots.push(root);
    const output = join(root, 'rewritten.git');
    const backupPath = join(root, 'before.bundle');
    const calls = [];
    let refReads = 0;
    let commitReads = 0;

    const runGit = async (args) => {
      calls.push(args);
      if (args[1] === 'clone') await mkdir(output);
      if (args.includes('bundle')) await writeFile(backupPath, 'bundle');
      if (args.includes('for-each-ref')) {
        refReads += 1;
        return {
          code: 0,
          stdout: refReads === 1
            ? 'refs/heads/main aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            : 'refs/heads/main bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          stderr: '',
        };
      }
      if (args.includes('rev-list')) {
        commitReads += 1;
        return {
          code: 0,
          stdout: commitReads === 1
            ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            : 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          stderr: '',
        };
      }
      if (args.includes('--mailmap')) {
        const mailmapPath = args[args.indexOf('--mailmap') + 1];
        expect(await readFile(mailmapPath, 'utf8')).toBe(createMailmap(mapping()));
      }
      return { code: 0, stdout: 'git-filter-repo 2.47.0', stderr: '' };
    };

    const result = await rewriteHistory({
      repository: '/safe/source.git',
      mapping: mapping(),
      output,
      backupPath,
    }, { runGit });

    expect(result).toMatchObject({
      status: 'finished',
      output,
      backupPath,
      changedCommits: 1,
      changedRefs: ['refs/heads/main'],
    });
    await expect(access(backupPath)).resolves.toBeUndefined();
    expect(calls.some((args) => args.includes('filter-branch'))).toBe(false);
    expect(calls).toContainEqual([
      'git', '-C', output, 'filter-repo', '--mailmap', expect.any(String), '--force',
    ]);
  });

  test('requires explicit confirmation and uses an exact force-with-lease for each changed ref', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-rewrite-push-test-'));
    roots.push(root);
    const output = join(root, 'rewritten.git');
    const backupPath = join(root, 'before.bundle');
    const pushes = [];
    let refReads = 0;
    const runGit = async (args) => {
      if (args[1] === 'clone') await mkdir(output);
      if (args.includes('bundle')) await writeFile(backupPath, 'bundle');
      if (args.includes('for-each-ref')) {
        refReads += 1;
        const sha = refReads === 1 ? 'a'.repeat(40) : 'b'.repeat(40);
        return { code: 0, stdout: `refs/heads/main ${sha}`, stderr: '' };
      }
      if (args.includes('rev-list')) return { code: 0, stdout: 'a'.repeat(40), stderr: '' };
      if (args.includes('push')) pushes.push(args);
      return { code: 0, stdout: 'ok', stderr: '' };
    };

    await expect(rewriteHistory({
      repository: 'https://gitlab.example.com/team/app.git',
      mapping: mapping(),
      output,
      backupPath,
      push: true,
    }, { runGit })).rejects.toThrow(HISTORY_REWRITE_CONFIRMATION);

    await expect(rewriteHistory({
      repository: 'https://gitlab.example.com/team/app.git',
      mapping: mapping(),
      output,
      backupPath,
      push: true,
      confirmation: HISTORY_REWRITE_CONFIRMATION,
    }, { runGit })).rejects.toThrow('fresh history-rewrite preview');

    await rewriteHistory({
      repository: 'https://gitlab.example.com/team/app.git',
      mapping: mapping(),
      output,
      backupPath,
      push: true,
      confirmation: HISTORY_REWRITE_CONFIRMATION,
      token: 'push-secret',
      preview: rewritePreview(
        { 'refs/heads/main': 'a'.repeat(40) },
        ['refs/heads/main'],
      ),
    }, { runGit });

    expect(pushes).toEqual([[
      'git', '-C', output, 'push', 'destination',
      `--force-with-lease=refs/heads/main:${'a'.repeat(40)}`,
      'refs/heads/main:refs/heads/main',
    ]]);
    expect(JSON.stringify(pushes)).not.toContain('push-secret');
  });

  test('refuses existing output/backup paths and a changed ref without a lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-rewrite-guard-test-'));
    roots.push(root);
    const existing = join(root, 'existing.git');
    await mkdir(existing);
    await expect(rewriteHistory({
      repository: '/safe/source.git',
      mapping: mapping(),
      output: existing,
    })).rejects.toThrow('Output path already exists');

    const output = join(root, 'output.git');
    const backupPath = join(root, 'existing.bundle');
    await writeFile(backupPath, 'existing');
    await expect(rewriteHistory({
      repository: '/safe/source.git',
      mapping: mapping(),
      output,
      backupPath,
    })).rejects.toThrow('Backup path already exists');

    const leaseOutput = join(root, 'lease.git');
    const leaseBackup = join(root, 'lease.bundle');
    let refReads = 0;
    const runGit = async (args) => {
      if (args[1] === 'clone') await mkdir(leaseOutput);
      if (args.includes('bundle')) await writeFile(leaseBackup, 'bundle');
      if (args.includes('for-each-ref')) {
        refReads += 1;
        return {
          code: 0,
          stdout: refReads === 1 ? '' : `refs/heads/new ${'b'.repeat(40)}`,
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    await expect(rewriteHistory({
      repository: '/safe/source.git',
      mapping: mapping(),
      output: leaseOutput,
      backupPath: leaseBackup,
      push: true,
      confirmation: HISTORY_REWRITE_CONFIRMATION,
      preview: rewritePreview({}, ['refs/heads/new']),
    }, { runGit })).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('no pre-rewrite lease'),
      backupPath: leaseBackup,
    });
  });

  test('returns a recoverable failed report when an exact lease push is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-rewrite-push-failure-'));
    roots.push(root);
    const output = join(root, 'rewritten.git');
    const backupPath = join(root, 'before.bundle');
    let refReads = 0;
    const runGit = async (args) => {
      if (args[1] === 'clone') await mkdir(output);
      if (args.includes('bundle')) await writeFile(backupPath, 'bundle');
      if (args.includes('for-each-ref')) {
        refReads += 1;
        return {
          code: 0,
          stdout: `refs/heads/main ${refReads === 1 ? 'a'.repeat(40) : 'b'.repeat(40)}`,
          stderr: '',
        };
      }
      if (args.includes('push')) {
        return { code: 1, stdout: '', stderr: 'stale info or protected branch' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const result = await rewriteHistory({
      repository: '/safe/source.git',
      mapping: mapping(),
      output,
      backupPath,
      push: true,
      confirmation: HISTORY_REWRITE_CONFIRMATION,
      preview: rewritePreview(
        { 'refs/heads/main': 'a'.repeat(40) },
        ['refs/heads/main'],
      ),
    }, { runGit });
    expect(result).toMatchObject({
      status: 'failed',
      output,
      backupPath,
      changedRefs: ['refs/heads/main'],
      pushedRefs: [],
      error: expect.stringContaining('protected branch'),
    });
    expect(result.recovery).toContain('git clone --mirror');
    await expect(access(backupPath)).resolves.toBeUndefined();
  });

  test('stops on a real force-with-lease conflict and preserves the bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-rewrite-real-lease-'));
    roots.push(root);
    const source = join(root, 'source.git');
    const destination = join(root, 'destination.git');
    const work = join(root, 'work');
    const output = join(root, 'rewritten.git');
    const backupPath = join(root, 'before.bundle');
    const git = (args, cwd = root, env = process.env) => execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
    }).trim();
    git(['init', '--bare', source]);
    git(['init', '--bare', destination]);
    git(['init', work]);
    git(['config', 'user.name', 'Old User'], work);
    git(['config', 'user.email', 'old@example.com'], work);
    await writeFile(join(work, 'README.md'), 'initial\n');
    git(['add', 'README.md'], work);
    git(['commit', '-m', 'initial'], work);
    git(['branch', '-M', 'main'], work);
    git(['push', source, 'main'], work);
    git(['push', destination, 'main'], work);
    const original = git(['--git-dir', destination, 'rev-parse', 'refs/heads/main']);

    const runGit = async (args, options) => {
      if (args[1] === 'filter-repo' && args[2] === '--version') {
        return { code: 0, stdout: 'test filter-repo', stderr: '' };
      }
      if (args.includes('--mailmap')) {
        await writeFile(join(work, 'concurrent.txt'), 'destination changed\n');
        git(['add', 'concurrent.txt'], work);
        git(['commit', '-m', 'concurrent destination update'], work);
        git(['push', destination, 'main'], work);

        const tree = git(['--git-dir', output, 'rev-parse', 'refs/heads/main^{tree}']);
        const identityEnv = {
          ...process.env,
          GIT_AUTHOR_NAME: 'New User',
          GIT_AUTHOR_EMAIL: 'new@example.com',
          GIT_COMMITTER_NAME: 'New User',
          GIT_COMMITTER_EMAIL: 'new@example.com',
        };
        const rewritten = git(
          ['--git-dir', output, 'commit-tree', tree, '-m', 'rewritten identity'],
          root,
          identityEnv,
        );
        git(['--git-dir', output, 'update-ref', 'refs/heads/main', rewritten]);
        return { code: 0, stdout: 'rewritten', stderr: '' };
      }
      return runGitCommand(args, options);
    };

    const result = await rewriteHistory({
      repository: source,
      destinationUrl: destination,
      mapping: mapping(),
      output,
      backupPath,
      push: true,
      confirmation: HISTORY_REWRITE_CONFIRMATION,
      preview: rewritePreview(
        { 'refs/heads/main': original },
        ['refs/heads/main'],
        1,
      ),
    }, { runGit });

    expect(result).toMatchObject({
      status: 'failed',
      changedRefs: ['refs/heads/main'],
      pushedRefs: [],
      backupPath,
    });
    expect(result.error).toMatch(/stale info|fetch first|rejected/i);
    expect(git(['--git-dir', destination, 'rev-parse', 'refs/heads/main'])).not.toBe(original);
    await expect(access(backupPath)).resolves.toBeUndefined();
  }, 30_000);
});
