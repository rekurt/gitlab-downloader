import { describe, expect, test } from '@jest/globals';
import { access, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGitCommand } from '../cloner.js';
import { withGitAskPass } from '../git-auth.js';

describe('withGitAskPass', () => {
  test('provides credentials without writing the token into the helper', async () => {
    let helperPath;
    await withGitAskPass('secret-value', async (env) => {
      helperPath = env.GIT_ASKPASS;
      const helper = await readFile(helperPath, 'utf8');
      expect(helper).not.toContain('secret-value');

      const username = await runGitCommand([helperPath, 'Username for https://gitlab.example.com'], {
        env,
      });
      const password = await runGitCommand([helperPath, 'Password for https://gitlab.example.com'], {
        env,
      });
      expect(username.stdout).toBe('oauth2');
      expect(password.stdout).toBe('secret-value');
    });

    await expect(access(helperPath)).rejects.toThrow();
  }, 15_000);

  test('removes the helper when the operation fails', async () => {
    let helperPath;
    await expect(
      withGitAskPass('secret-value', async (env) => {
        helperPath = env.GIT_ASKPASS;
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');
    await expect(access(helperPath)).rejects.toThrow();
  });

  test('rejects tokens containing control characters', async () => {
    await expect(withGitAskPass('unsafe\ntoken', async () => {})).rejects.toThrow(
      'Token contains invalid characters',
    );
  });

  test('creates a Windows command wrapper without embedding the token', async () => {
    await withGitAskPass('windows-secret', async (env) => {
      expect(env.GIT_ASKPASS).toMatch(/askpass\.cmd$/);
      const command = await readFile(env.GIT_ASKPASS, 'utf8');
      expect(command).toContain('GITLAB_DUMP_ASKPASS_RUNTIME');
      expect(env.GITLAB_DUMP_ASKPASS_RUNTIME).toBe('C:\\Runtime\\custom-node.exe');
      expect(command).not.toContain('windows-secret');
    }, { platform: 'win32', execPath: 'C:\\Runtime\\custom-node.exe' });
  });

  const unixTest = process.platform === 'win32' ? test.skip : test;
  unixTest('runs through a runtime path containing spaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitlab-dump-runtime-space-'));
    try {
      const spacedRuntime = join(root, 'node runtime');
      await symlink(process.execPath, spacedRuntime);
      await withGitAskPass('space-safe-secret', async (env) => {
        const result = await runGitCommand([env.GIT_ASKPASS, 'Password:'], { env });
        expect(result).toMatchObject({ code: 0, stdout: 'space-safe-secret' });
      }, { execPath: spacedRuntime });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('requires a non-empty token', async () => {
    await expect(withGitAskPass('', async () => {})).rejects.toThrow('Token is required');
  });
});
