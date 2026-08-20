import { afterEach, describe, expect, test } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binary = join(cliRoot, 'bin', 'gitlab-dump.js');
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function run(args, env = {}) {
  return spawnSync(process.execPath, [binary, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runAsync(args, env = {}, onSpawn = () => {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binary, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    onSpawn(child);
  });
}

async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

describe('real gitlab-dump executable', () => {
  test('prints the 0.2.0 subcommand help', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('clone');
    expect(result.stdout).toContain('transfer');
    expect(result.stdout).toContain('rewrite-history');
  });

  test('rejects the removed invocation without a subcommand', () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('subcommand');
  });

  test('rejects token flags without echoing the supplied secret', () => {
    const result = run(['clone', '--token', 'must-not-leak']);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain('must-not-leak');
  });

  test('prints a token-free JSON dry-run report against a local fake GitLab', async () => {
    let observedToken;
    const url = await listen((request, response) => {
      observedToken = request.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{
        id: 41,
        name: 'Application',
        path: 'app',
        path_with_namespace: 'team/app',
        http_url_to_repo: `${url}/team/app.git`,
      }]));
    });

    const result = await runAsync(['clone', '--url', url, '--dry-run'], {
      GITLAB_SOURCE_TOKEN: 'binary-secret',
    });

    expect(result.code).toBe(0);
    expect(observedToken).toBe('Bearer binary-secret');
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'preview',
      repositories: [{ id: 41, fullPath: 'team/app', repoName: 'app' }],
    });
    expect(`${result.stdout}${result.stderr}`).not.toContain('binary-secret');
  });

  const signalTest = process.platform === 'win32' ? test.skip : test.each(['SIGINT', 'SIGTERM']);
  signalTest('maps %s cancellation to exit code 130 without leaking credentials', async (signal) => {
    let requestSeen;
    const seen = new Promise((resolve) => { requestSeen = resolve; });
    const url = await listen(() => requestSeen());
    let child;
    const completed = runAsync(['clone', '--url', url, '--timeout', '60'], {
      GITLAB_SOURCE_TOKEN: 'signal-secret',
    }, (spawned) => { child = spawned; });
    await seen;
    child.kill(signal);
    const result = await completed;

    expect(result.code).toBe(130);
    expect(`${result.stdout}${result.stderr}`).not.toContain('signal-secret');
  });
});
