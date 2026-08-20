import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ASKPASS_SCRIPT = `
const prompt = process.argv.slice(2).join(' ');
if (/username/i.test(prompt)) {
  process.stdout.write('oauth2');
} else {
  process.stdout.write(process.env.GITLAB_DUMP_ASKPASS_TOKEN || '');
}
`;

export async function withGitAskPass(token, operation, options = {}) {
  if (!token) throw new Error('Token is required for authenticated Git operations');
  if (/\r|\n|\0/.test(token)) throw new Error('Token contains invalid characters');

  const directory = await mkdtemp(join(tmpdir(), 'gitlab-dump-askpass-'));
  const scriptPath = join(directory, 'askpass.js');
  let helperPath;
  try {
    const platform = options.platform ?? process.platform;
    const execPath = options.execPath ?? process.execPath;
    await writeFile(scriptPath, ASKPASS_SCRIPT, { mode: 0o600 });
    if (platform === 'win32') {
      const commandPath = join(directory, 'askpass.cmd');
      await writeFile(
        commandPath,
        '@echo off\r\n"%GITLAB_DUMP_ASKPASS_RUNTIME%" "%GITLAB_DUMP_ASKPASS_SCRIPT%" %*\r\n',
        { mode: 0o700 },
      );
      helperPath = commandPath;
    } else {
      helperPath = join(directory, 'askpass.sh');
      await writeFile(
        helperPath,
        '#!/bin/sh\nexec "$GITLAB_DUMP_ASKPASS_RUNTIME" "$GITLAB_DUMP_ASKPASS_SCRIPT" "$@"\n',
        { mode: 0o700 },
      );
      await chmod(helperPath, 0o700);
    }

    return await operation({
      GIT_ASKPASS: helperPath,
      GIT_ASKPASS_REQUIRE: 'force',
      GIT_TERMINAL_PROMPT: '0',
      GITLAB_DUMP_ASKPASS_TOKEN: token,
      GITLAB_DUMP_ASKPASS_RUNTIME: execPath,
      GITLAB_DUMP_ASKPASS_SCRIPT: scriptPath,
      ELECTRON_RUN_AS_NODE: '1',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
