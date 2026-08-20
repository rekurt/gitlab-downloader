import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findGitRepositories } from '../repository-discovery.js';

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('findGitRepositories', () => {
  test('finds nested repositories and redacts credentials from legacy origins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-discovery-test-'));
    roots.push(root);
    const repository = join(root, 'group', 'app');
    await mkdir(join(repository, '.git'), { recursive: true });
    await writeFile(
      join(repository, '.git', 'config'),
      '[remote "origin"]\n\turl = https://oauth2:legacy-secret@gitlab.example.com/group/app.git\n',
    );
    await writeFile(join(repository, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    expect(findGitRepositories(root)).toEqual([
      expect.objectContaining({
        name: 'app',
        path: repository,
        url: 'https://gitlab.example.com/group/app.git',
      }),
    ]);
    expect(JSON.stringify(findGitRepositories(root))).not.toContain('legacy-secret');
  });

  test('skips hidden and node_modules trees and respects maxDepth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-discovery-depth-test-'));
    roots.push(root);
    await mkdir(join(root, '.hidden', 'repo', '.git'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'repo', '.git'), { recursive: true });
    await mkdir(join(root, 'a', 'b', 'repo', '.git'), { recursive: true });
    expect(findGitRepositories(root, 1)).toEqual([]);
    expect(findGitRepositories(root, 4)).toHaveLength(1);
  });
});
