import { jest } from '@jest/globals';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProgram, optsToConfig, findGitRepos, validateCloneConfig } from '../index.js';

// ─── buildProgram ─────────────────────────────────────────────

describe('buildProgram', () => {
  test('returns a Commander program', () => {
    const program = buildProgram();
    expect(program.name()).toBe('gitlab-dump');
  });

  test('parses --url option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--url', 'https://gitlab.com']);
    expect(program.opts().url).toBe('https://gitlab.com');
  });

  test('parses --token option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--token', 'my-secret']);
    expect(program.opts().token).toBe('my-secret');
  });

  test('parses --group option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--group', 'my-group']);
    expect(program.opts().group).toBe('my-group');
  });

  test('parses --clone-path option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--clone-path', '/tmp/repos']);
    expect(program.opts().clonePath).toBe('/tmp/repos');
  });

  test('parses --dry-run flag', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--dry-run']);
    expect(program.opts().dryRun).toBe(true);
  });

  test('dry-run defaults to false', () => {
    const program = buildProgram();
    program.parse(['node', 'test']);
    expect(program.opts().dryRun).toBe(false);
  });

  test('parses --update flag', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--update']);
    expect(program.opts().update).toBe(true);
  });

  test('parses --interactive flag', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--interactive']);
    expect(program.opts().interactive).toBe(true);
  });

  test('parses --interactive-menu flag', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--interactive-menu']);
    expect(program.opts().interactiveMenu).toBe(true);
  });

  test('parses --concurrency as integer', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--concurrency', '10']);
    expect(program.opts().concurrency).toBe(10);
  });

  test('parses --per-page as integer', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--per-page', '50']);
    expect(program.opts().perPage).toBe(50);
  });

  test('parses --timeout as integer', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--timeout', '60']);
    expect(program.opts().timeout).toBe(60);
  });

  test('parses --api-retries as integer', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--api-retries', '5']);
    expect(program.opts().apiRetries).toBe(5);
  });

  test('parses --clone-retries as integer', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--clone-retries', '3']);
    expect(program.opts().cloneRetries).toBe(3);
  });

  test('parses --auth-method option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--auth-method', 'token']);
    expect(program.opts().authMethod).toBe('token');
  });

  test('parses --git-auth-mode option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--git-auth-mode', 'credential_helper']);
    expect(program.opts().gitAuthMode).toBe('credential_helper');
  });

  test('parses --oauth-client-id option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--oauth-client-id', 'abc123']);
    expect(program.opts().oauthClientId).toBe('abc123');
  });

  test('parses --oauth-client-secret option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--oauth-client-secret', 'secret']);
    expect(program.opts().oauthClientSecret).toBe('secret');
  });

  test('parses --oauth-scope option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--oauth-scope', 'api']);
    expect(program.opts().oauthScope).toBe('api');
  });

  test('parses --log-level option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--log-level', 'DEBUG']);
    expect(program.opts().logLevel).toBe('DEBUG');
  });

  test('parses --report-json option', () => {
    const program = buildProgram();
    program.parse(['node', 'test', '--report-json', '/tmp/report.json']);
    expect(program.opts().reportJson).toBe('/tmp/report.json');
  });

  test('parses multiple options together', () => {
    const program = buildProgram();
    program.parse([
      'node', 'test',
      '--url', 'https://gitlab.example.com',
      '--token', 'tok123',
      '--group', 'my/group',
      '--clone-path', '/data/repos',
      '--dry-run',
      '--concurrency', '8',
    ]);
    const opts = program.opts();
    expect(opts.url).toBe('https://gitlab.example.com');
    expect(opts.token).toBe('tok123');
    expect(opts.group).toBe('my/group');
    expect(opts.clonePath).toBe('/data/repos');
    expect(opts.dryRun).toBe(true);
    expect(opts.concurrency).toBe(8);
  });
});

// ─── optsToConfig ─────────────────────────────────────────────

describe('optsToConfig', () => {
  test('maps commander opts to config object', () => {
    const opts = {
      url: 'https://gitlab.com',
      token: 'tok',
      group: 'grp',
      clonePath: '/repos',
      perPage: 50,
      timeout: 60,
      apiRetries: 5,
      cloneRetries: 3,
      concurrency: 10,
      dryRun: true,
      update: true,
      logLevel: 'DEBUG',
      reportJson: '/tmp/report.json',
      authMethod: 'token',
      gitAuthMode: 'credential_helper',
      oauthClientId: 'cid',
      oauthClientSecret: 'csecret',
      oauthScope: 'api',
      interactive: false,
      interactiveMenu: false,
    };

    const config = optsToConfig(opts);

    expect(config.url).toBe('https://gitlab.com');
    expect(config.token).toBe('tok');
    expect(config.group).toBe('grp');
    expect(config.clonePath).toBe('/repos');
    expect(config.perPage).toBe(50);
    expect(config.requestTimeout).toBe(60);
    expect(config.maxRetries).toBe(5);
    expect(config.cloneRetries).toBe(3);
    expect(config.maxConcurrency).toBe(10);
    expect(config.dryRun).toBe(true);
    expect(config.updateExisting).toBe(true);
    expect(config.logLevel).toBe('DEBUG');
    expect(config.reportJson).toBe('/tmp/report.json');
    expect(config.authMethod).toBe('token');
    expect(config.gitAuthMode).toBe('credential_helper');
    expect(config.oauthClientId).toBe('cid');
    expect(config.oauthClientSecret).toBe('csecret');
    expect(config.oauthScope).toBe('api');
  });

  test('handles missing optional fields', () => {
    const config = optsToConfig({});
    expect(config.url).toBe('');
    expect(config.token).toBeNull();
    expect(config.group).toBeNull();
    expect(config.dryRun).toBe(false);
    expect(config.updateExisting).toBe(false);
    expect(config.reportJson).toBeNull();
    expect(config.oauthClientId).toBeNull();
    expect(config.oauthClientSecret).toBeNull();
  });

  test('uses defaults for numeric fields when undefined', () => {
    const config = optsToConfig({});
    expect(config.perPage).toBe(100);
    expect(config.requestTimeout).toBe(30);
    expect(config.maxRetries).toBe(3);
    expect(config.cloneRetries).toBe(2);
    expect(config.maxConcurrency).toBe(5);
  });
});

// ─── validateCloneConfig ─────────────────────────────────────

describe('validateCloneConfig', () => {
  test('returns error when url is missing', () => {
    const err = validateCloneConfig({ url: '', authMethod: 'token', token: 'tok' });
    expect(err).toContain('URL is required');
  });

  test('returns error when token is missing for token auth', () => {
    const err = validateCloneConfig({ url: 'https://gitlab.com', authMethod: 'token', token: null });
    expect(err).toContain('token is required');
  });

  test('returns error when oauth client id is missing for oauth auth', () => {
    const err = validateCloneConfig({ url: 'https://gitlab.com', authMethod: 'oauth', oauthClientId: null });
    expect(err).toContain('OAuth client ID is required');
  });

  test('returns null for valid token config', () => {
    const err = validateCloneConfig({
      url: 'https://gitlab.com',
      authMethod: 'token',
      token: 'my-token',
    });
    expect(err).toBeNull();
  });

  test('returns null for valid oauth config', () => {
    const err = validateCloneConfig({
      url: 'https://gitlab.com',
      authMethod: 'oauth',
      oauthClientId: 'cid',
    });
    expect(err).toBeNull();
  });
});

// ─── findGitRepos ─────────────────────────────────────────────

describe('findGitRepos', () => {
  const testDir = join(tmpdir(), `cli-test-repos-${Date.now()}`);

  beforeAll(() => {
    // Create structure:
    // testDir/
    //   repo1/.git/
    //   group/repo2/.git/
    //   group/subgroup/repo3/.git/
    //   not-a-repo/
    mkdirSync(join(testDir, 'repo1', '.git'), { recursive: true });
    mkdirSync(join(testDir, 'group', 'repo2', '.git'), { recursive: true });
    mkdirSync(join(testDir, 'group', 'subgroup', 'repo3', '.git'), { recursive: true });
    mkdirSync(join(testDir, 'not-a-repo'), { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test('finds all git repos recursively', () => {
    const repos = findGitRepos(testDir);
    expect(repos).toHaveLength(3);
  });

  test('includes root-level repos', () => {
    const repos = findGitRepos(testDir);
    expect(repos).toContain(join(testDir, 'repo1'));
  });

  test('includes nested repos', () => {
    const repos = findGitRepos(testDir);
    expect(repos).toContain(join(testDir, 'group', 'repo2'));
    expect(repos).toContain(join(testDir, 'group', 'subgroup', 'repo3'));
  });

  test('does not include non-repo directories', () => {
    const repos = findGitRepos(testDir);
    expect(repos).not.toContain(join(testDir, 'not-a-repo'));
  });

  test('respects maxDepth', () => {
    const repos = findGitRepos(testDir, 0);
    // At depth 0, we should find repo1 (it's at the first level of entries)
    // but group/ is not a repo itself, so repos under group need depth > 0
    expect(repos.some((r) => r.includes('repo3'))).toBe(false);
  });

  test('returns empty for non-existent directory', () => {
    const repos = findGitRepos('/non/existent/path');
    expect(repos).toHaveLength(0);
  });

  test('handles empty directory', () => {
    const emptyDir = join(testDir, 'empty');
    mkdirSync(emptyDir, { recursive: true });
    const repos = findGitRepos(emptyDir);
    expect(repos).toHaveLength(0);
  });

  test('directory that is itself a git repo', () => {
    const repoDir = join(testDir, 'repo1');
    const repos = findGitRepos(repoDir);
    expect(repos).toHaveLength(1);
    expect(repos[0]).toBe(repoDir);
  });
});
