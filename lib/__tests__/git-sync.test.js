import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { syncRepository } from '../git-sync.js';

const roots = [];
jest.setTimeout(20_000);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-sync-test-'));
  roots.push(root);
  const source = join(root, 'source.git');
  const destination = join(root, 'destination.git');
  const work = join(root, 'work');
  git(['init', '--bare', source], root);
  git(['init', '--bare', destination], root);
  git(['init', work], root);
  git(['config', 'user.name', 'Test User'], work);
  git(['config', 'user.email', 'test@example.com'], work);
  await writeFile(join(work, 'README.md'), 'base\n');
  git(['add', 'README.md'], work);
  git(['commit', '-m', 'base'], work);
  git(['branch', '-M', 'main'], work);
  git(['remote', 'add', 'source', source], work);
  git(['remote', 'add', 'destination', destination], work);
  git(['push', 'source', 'main'], work);
  git(['push', 'destination', 'main'], work);
  return { root, source, destination, work };
}

function ref(repository, name) {
  return git(['--git-dir', repository, 'rev-parse', name]);
}

describe('syncRepository', () => {
  function mockedGit(overrides = {}) {
    return jest.fn(async (args) => {
      if (args.includes('for-each-ref')) {
        const destination = args.some((item) => String(item).includes('gitlab-dump/destination'));
        return { code: 0, stdout: destination ? (overrides.destinationRefs || '') : (overrides.sourceRefs || ''), stderr: '' };
      }
      if (args.includes('merge-base')) return overrides.mergeBase || { code: 0, stdout: '', stderr: '' };
      if (args[1] === 'lfs' && args[2] === 'version') return overrides.lfsVersion || { code: 0, stdout: 'git-lfs', stderr: '' };
      if (args.includes('lfs') && args.includes('fetch')) return overrides.lfsFetch || { code: 0, stdout: '', stderr: '' };
      if (args.includes('lfs') && args.includes('push')) return overrides.lfsPush || { code: 0, stdout: '', stderr: '' };
      if (args[1] === 'ls-remote') return overrides.lsRemote || { code: 0, stdout: '', stderr: '' };
      if (args[1] === 'clone') return overrides.clone || { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    });
  }

  test('validates distinct source and destination URLs', async () => {
    await expect(syncRepository({}, { includeLfs: false })).rejects.toThrow(
      'Both source and destination',
    );
    await expect(syncRepository({
      sourceUrl: 'https://gitlab.example.com/team/app.git',
      destinationUrl: 'https://gitlab.example.com/team/app.git',
    }, { includeLfs: false })).rejects.toThrow('must be different');
  });

  test('reports unavailable and failed LFS operations without leaking tokens', async () => {
    const unavailable = await syncRepository({
      sourceUrl: 'https://source.example.com/team/app.git',
      destinationUrl: 'https://destination.example.com/archive/app.git',
    }, {
      runGit: mockedGit({ lfsVersion: { code: 1, stdout: '', stderr: '' } }),
    });
    expect(unavailable).toMatchObject({ status: 'partial', lfs: { status: 'unavailable' } });

    const fetchFailed = await syncRepository({
      sourceUrl: 'https://source.example.com/team/app.git',
      destinationUrl: 'https://destination.example.com/archive/app.git',
      sourceToken: 'source-secret',
      destinationToken: 'destination-secret',
    }, {
      runGit: mockedGit({
        lfsFetch: { code: 1, stdout: '', stderr: 'failed for source-secret' },
      }),
    });
    expect(fetchFailed.status).toBe('partial');
    expect(fetchFailed.lfs.message).toContain('***');
    expect(fetchFailed.lfs.message).not.toContain('source-secret');

    const pushFailed = await syncRepository({
      sourceUrl: 'https://source.example.com/team/app.git',
      destinationUrl: 'https://destination.example.com/archive/app.git',
    }, {
      runGit: mockedGit({ lfsPush: { code: 1, stdout: '', stderr: 'protected' } }),
    });
    expect(pushFailed).toMatchObject({ status: 'partial', lfs: { status: 'failed' } });
  });

  test('redacts Git errors and rejects indeterminate ancestry', async () => {
    await expect(syncRepository({
      sourceUrl: 'https://source.example.com/team/app.git',
      destinationUrl: 'https://destination.example.com/archive/app.git',
      sourceToken: 'source-secret',
    }, {
      includeLfs: false,
      runGit: mockedGit({ clone: { code: 1, stdout: '', stderr: 'bad source-secret' } }),
    })).rejects.toThrow('bad ***');

    await expect(syncRepository({
      sourceUrl: 'https://source.example.com/team/app.git',
      destinationUrl: 'https://destination.example.com/archive/app.git',
    }, {
      includeLfs: false,
      runGit: mockedGit({
        sourceRefs: `refs/heads/main ${'b'.repeat(40)}`,
        destinationRefs: `refs/gitlab-dump/destination/heads/main ${'a'.repeat(40)}`,
        mergeBase: { code: 2, stdout: '', stderr: 'bad repository' },
      }),
    })).rejects.toThrow('merge-base');
  });

  test('reports a missing wiki repository and emits lifecycle progress', async () => {
    const events = [];
    const result = await syncRepository({
      sourceFullPath: 'team/app',
      destinationFullPath: 'archive/app',
    }, {
      source: { url: 'https://source.example.com' },
      destination: { url: 'https://destination.example.com' },
      includeLfs: false,
      runGit: mockedGit({ lsRemote: { code: 2, stdout: '', stderr: 'repository not found' } }),
      onEvent: (event) => events.push(event),
    });
    expect(result.wiki).toMatchObject({ status: 'skipped' });
    expect(events).toEqual([
      expect.objectContaining({ status: 'running', progress: 0 }),
      expect.objectContaining({ status: 'finished', progress: 1 }),
    ]);
  });

  test('reports a wiki inspection failure as partial and redacts its diagnostics', async () => {
    const result = await syncRepository({
      sourceFullPath: 'team/app',
      destinationFullPath: 'archive/app',
      sourceToken: 'source-secret',
    }, {
      source: { url: 'https://source.example.com' },
      destination: { url: 'https://destination.example.com' },
      includeLfs: false,
      runGit: mockedGit({
        lsRemote: { code: 2, stdout: '', stderr: 'network failed for source-secret' },
      }),
    });

    expect(result).toMatchObject({ status: 'partial', wiki: { status: 'failed' } });
    expect(result.wiki.message).toContain('***');
    expect(result.wiki.message).not.toContain('source-secret');
  });

  test('adds new refs, fast-forwards branches, and never deletes destination refs', async () => {
    const { source, destination, work } = await fixture();
    await writeFile(join(work, 'README.md'), 'base\nsource update\n');
    git(['add', 'README.md'], work);
    git(['commit', '-m', 'source update'], work);
    git(['push', 'source', 'main'], work);
    git(['checkout', '-b', 'feature'], work);
    await writeFile(join(work, 'feature.txt'), 'feature\n');
    git(['add', 'feature.txt'], work);
    git(['commit', '-m', 'feature'], work);
    git(['push', 'source', 'feature'], work);
    git(['tag', 'v2'], work);
    git(['push', 'source', 'v2'], work);
    git(['push', 'destination', 'HEAD:refs/heads/destination-only'], work);

    const result = await syncRepository(
      { sourceUrl: source, destinationUrl: destination },
      { includeLfs: false },
    );

    expect(result.status).toBe('finished');
    expect(result.pushed).toEqual([
      'refs/heads/feature',
      'refs/heads/main',
      'refs/tags/v2',
    ]);
    expect(result.conflicts).toEqual([]);
    expect(ref(destination, 'refs/heads/main')).toBe(ref(source, 'refs/heads/main'));
    expect(ref(destination, 'refs/heads/feature')).toBe(ref(source, 'refs/heads/feature'));
    expect(ref(destination, 'refs/tags/v2')).toBe(ref(source, 'refs/tags/v2'));
    expect(ref(destination, 'refs/heads/destination-only')).toBeTruthy();
  });

  test('cancels a real mirror synchronization before changing destination refs', async () => {
    const { source, destination } = await fixture();
    const original = ref(destination, 'refs/heads/main');
    const controller = new AbortController();
    controller.abort(new DOMException('Canceled', 'AbortError'));

    await expect(syncRepository(
      { sourceUrl: source, destinationUrl: destination },
      { includeLfs: false, signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(ref(destination, 'refs/heads/main')).toBe(original);
  });

  test('leaves divergent branches and conflicting tags untouched', async () => {
    const { root, source, destination, work } = await fixture();
    await writeFile(join(work, 'source.txt'), 'source\n');
    git(['add', 'source.txt'], work);
    git(['commit', '-m', 'source branch'], work);
    git(['push', 'source', 'main'], work);
    git(['tag', 'v1'], work);
    git(['push', 'source', 'v1'], work);

    const destinationWork = join(root, 'destination-work');
    git(['clone', destination, destinationWork], root);
    git(['checkout', 'main'], destinationWork);
    git(['config', 'user.name', 'Destination User'], destinationWork);
    git(['config', 'user.email', 'destination@example.com'], destinationWork);
    await writeFile(join(destinationWork, 'destination.txt'), 'destination\n');
    git(['add', 'destination.txt'], destinationWork);
    git(['commit', '-m', 'destination branch'], destinationWork);
    git(['push', 'origin', 'main'], destinationWork);
    git(['tag', 'v1'], destinationWork);
    git(['push', 'origin', 'v1'], destinationWork);
    const originalBranch = ref(destination, 'refs/heads/main');
    const originalTag = ref(destination, 'refs/tags/v1');

    const result = await syncRepository(
      { sourceUrl: source, destinationUrl: destination },
      { includeLfs: false },
    );

    expect(result.status).toBe('partial');
    expect(result.pushed).toEqual([]);
    expect(result.conflicts).toEqual(['refs/heads/main', 'refs/tags/v1']);
    expect(ref(destination, 'refs/heads/main')).toBe(originalBranch);
    expect(ref(destination, 'refs/tags/v1')).toBe(originalTag);
  });

  test('synchronizes the project wiki repository when it exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-wiki-sync-test-'));
    roots.push(root);
    const sourceBase = join(root, 'source');
    const destinationBase = join(root, 'destination');
    const sourceProject = join(sourceBase, 'team', 'app.git');
    const destinationProject = join(destinationBase, 'archive', 'app.git');
    const sourceWiki = join(sourceBase, 'team', 'app.wiki.git');
    const destinationWiki = join(destinationBase, 'archive', 'app.wiki.git');
    const projectWork = join(root, 'project-work');
    const wikiWork = join(root, 'wiki-work');
    await Promise.all([
      mkdir(join(sourceBase, 'team'), { recursive: true }),
      mkdir(join(destinationBase, 'archive'), { recursive: true }),
    ]);
    for (const bare of [sourceProject, destinationProject, sourceWiki, destinationWiki]) git(['init', '--bare', bare], root);
    for (const [work, file, content, source, destination] of [
      [projectWork, 'README.md', 'project\n', sourceProject, destinationProject],
      [wikiWork, 'Home.md', 'wiki\n', sourceWiki, destinationWiki],
    ]) {
      git(['init', work], root);
      git(['config', 'user.name', 'Test User'], work);
      git(['config', 'user.email', 'test@example.com'], work);
      await writeFile(join(work, file), content);
      git(['add', file], work);
      git(['commit', '-m', 'base'], work);
      git(['branch', '-M', 'main'], work);
      git(['push', source, 'main'], work);
      git(['push', destination, 'main'], work);
    }
    await writeFile(join(wikiWork, 'Home.md'), 'wiki\nupdated\n');
    git(['add', 'Home.md'], wikiWork);
    git(['commit', '-m', 'wiki update'], wikiWork);
    git(['push', sourceWiki, 'main'], wikiWork);

    const result = await syncRepository({
      sourceFullPath: 'team/app',
      destinationFullPath: 'archive/app',
    }, {
      source: { url: sourceBase },
      destination: { url: destinationBase },
      includeLfs: false,
    });

    expect(result.status).toBe('finished');
    expect(result.wiki).toMatchObject({ status: 'finished', pushed: ['refs/heads/main'] });
    expect(ref(destinationWiki, 'refs/heads/main')).toBe(ref(sourceWiki, 'refs/heads/main'));
  });
});
