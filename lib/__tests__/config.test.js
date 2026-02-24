import { jest } from '@jest/globals';
import { GitlabConfigSchema, validateGitlabUrl, parseConfig } from '../config.js';

describe('validateGitlabUrl', () => {
  test('accepts valid https URL', () => {
    expect(validateGitlabUrl('https://gitlab.com')).toBe(true);
  });

  test('accepts valid http URL', () => {
    expect(validateGitlabUrl('http://gitlab.local')).toBe(true);
  });

  test('accepts URL with port', () => {
    expect(validateGitlabUrl('https://gitlab.example.com:8443')).toBe(true);
  });

  test('rejects ftp protocol', () => {
    expect(validateGitlabUrl('ftp://gitlab.com')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateGitlabUrl('')).toBe(false);
  });

  test('rejects bare hostname', () => {
    expect(validateGitlabUrl('gitlab.com')).toBe(false);
  });

  test('rejects invalid URL', () => {
    expect(validateGitlabUrl('not-a-url')).toBe(false);
  });
});

describe('GitlabConfigSchema', () => {
  const validConfig = {
    url: 'https://gitlab.com',
    token: 'glpat-xxxxxxxxxxxxxxxxxxxx',
    group: 'my-group',
    clonePath: 'repos',
    perPage: 100,
    requestTimeout: 30,
    maxRetries: 3,
    cloneRetries: 2,
    maxConcurrency: 5,
    dryRun: false,
    updateExisting: false,
    logLevel: 'INFO',
    logFile: null,
    interactive: false,
    interactiveMenu: false,
    reportJson: null,
    authMethod: 'token',
    gitAuthMode: 'url',
    oauthClientId: null,
    oauthClientSecret: null,
    oauthScope: 'read_api read_repository',
    oauthCachePath: '/tmp/oauth.json',
  };

  test('parses valid config', () => {
    const result = GitlabConfigSchema.parse(validConfig);
    expect(result.url).toBe('https://gitlab.com');
    expect(result.token).toBe('glpat-xxxxxxxxxxxxxxxxxxxx');
    expect(result.maxConcurrency).toBe(5);
  });

  test('strips trailing slashes from URL', () => {
    const result = GitlabConfigSchema.parse({ ...validConfig, url: 'https://gitlab.com///' });
    expect(result.url).toBe('https://gitlab.com');
  });

  test('rejects invalid URL', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, url: 'not-a-url' })
    ).toThrow();
  });

  test('rejects empty URL', () => {
    expect(() => GitlabConfigSchema.parse({ ...validConfig, url: '' })).toThrow();
  });

  test('rejects ftp URL', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, url: 'ftp://gitlab.com' })
    ).toThrow();
  });

  test('rejects concurrency below minimum', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, maxConcurrency: 0 })
    ).toThrow();
  });

  test('rejects concurrency above maximum', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, maxConcurrency: 100 })
    ).toThrow();
  });

  test('rejects negative timeout', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, requestTimeout: -1 })
    ).toThrow();
  });

  test('rejects zero timeout', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, requestTimeout: 0 })
    ).toThrow();
  });

  test('rejects invalid auth method', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, authMethod: 'invalid' })
    ).toThrow();
  });

  test('rejects invalid git auth mode', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, gitAuthMode: 'invalid' })
    ).toThrow();
  });

  test('applies defaults for missing optional fields', () => {
    const minimal = {
      url: 'https://gitlab.com',
    };
    const result = GitlabConfigSchema.parse(minimal);
    expect(result.token).toBeNull();
    expect(result.group).toBeNull();
    expect(result.clonePath).toBe('repositories');
    expect(result.perPage).toBe(100);
    expect(result.requestTimeout).toBe(30);
    expect(result.maxRetries).toBe(3);
    expect(result.cloneRetries).toBe(2);
    expect(result.maxConcurrency).toBe(5);
    expect(result.dryRun).toBe(false);
    expect(result.updateExisting).toBe(false);
    expect(result.authMethod).toBe('oauth');
    expect(result.gitAuthMode).toBe('url');
  });

  test('accepts null token', () => {
    const result = GitlabConfigSchema.parse({ ...validConfig, token: null });
    expect(result.token).toBeNull();
  });

  test('rejects negative clone retries', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, cloneRetries: -1 })
    ).toThrow();
  });

  test('rejects zero max retries', () => {
    expect(() =>
      GitlabConfigSchema.parse({ ...validConfig, maxRetries: 0 })
    ).toThrow();
  });
});

describe('parseConfig', () => {
  test('wraps schema parse', () => {
    const result = parseConfig({
      url: 'https://gitlab.com',
      authMethod: 'token',
      token: 'test-token',
    });
    expect(result.url).toBe('https://gitlab.com');
    expect(result.token).toBe('test-token');
  });

  test('throws on invalid input', () => {
    expect(() => parseConfig({ url: '' })).toThrow();
  });
});
