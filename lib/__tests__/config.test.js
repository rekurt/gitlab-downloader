import { jest } from '@jest/globals';
import { GitlabConfigSchema, validateGitlabUrl, parseConfig, loadConfigFromEnv } from '../config.js';

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

describe('loadConfigFromEnv', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
  });

  test('loads default config from environment', () => {
    process.env.GITLAB_URL = 'https://gitlab.example.com';
    process.env.GITLAB_TOKEN = 'test-token';
    process.env.GITLAB_GROUP = 'my-group';
    process.env.CLONE_PATH = '/tmp/repos';

    const config = loadConfigFromEnv();
    expect(config.url).toBe('https://gitlab.example.com');
    expect(config.token).toBe('test-token');
    expect(config.group).toBe('my-group');
    expect(config.clonePath).toBe('/tmp/repos');
  });

  test('returns defaults when env vars are not set', () => {
    delete process.env.GITLAB_URL;
    delete process.env.GITLAB_TOKEN;
    delete process.env.GITLAB_GROUP;
    delete process.env.CLONE_PATH;

    const config = loadConfigFromEnv({ envPath: '/nonexistent/.env' });
    expect(config.token).toBeNull();
    expect(config.group).toBeNull();
    expect(config.clonePath).toBe('repositories');
  });

  test('parses integer env vars', () => {
    process.env.GITLAB_URL = 'https://gitlab.com';
    process.env.PER_PAGE = '50';
    process.env.REQUEST_TIMEOUT = '60';
    process.env.MAX_RETRIES = '5';
    process.env.CLONE_RETRIES = '3';
    process.env.MAX_CONCURRENCY = '10';

    const config = loadConfigFromEnv();
    expect(config.perPage).toBe(50);
    expect(config.requestTimeout).toBe(60);
    expect(config.maxRetries).toBe(5);
    expect(config.cloneRetries).toBe(3);
    expect(config.maxConcurrency).toBe(10);
  });

  test('handles invalid integer env vars gracefully', () => {
    process.env.GITLAB_URL = 'https://gitlab.com';
    process.env.PER_PAGE = 'not-a-number';

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadConfigFromEnv();
    expect(config.perPage).toBe(100); // default
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('parses boolean env vars', () => {
    process.env.GITLAB_URL = 'https://gitlab.com';
    process.env.DRY_RUN = 'true';
    process.env.UPDATE_EXISTING = '1';
    process.env.INTERACTIVE = 'yes';
    process.env.INTERACTIVE_MENU = 'on';

    const config = loadConfigFromEnv();
    expect(config.dryRun).toBe(true);
    expect(config.updateExisting).toBe(true);
    expect(config.interactive).toBe(true);
    expect(config.interactiveMenu).toBe(true);
  });

  test('boolean env vars default to false', () => {
    process.env.GITLAB_URL = 'https://gitlab.com';
    process.env.DRY_RUN = 'false';
    process.env.UPDATE_EXISTING = '0';

    const config = loadConfigFromEnv();
    expect(config.dryRun).toBe(false);
    expect(config.updateExisting).toBe(false);
  });

  test('reads auth config from environment', () => {
    process.env.GITLAB_URL = 'https://gitlab.com';
    process.env.AUTH_METHOD = 'token';
    process.env.GIT_AUTH_MODE = 'credential_helper';
    process.env.GITLAB_OAUTH_CLIENT_ID = 'my-client-id';
    process.env.GITLAB_OAUTH_CLIENT_SECRET = 'my-secret';
    process.env.GITLAB_OAUTH_SCOPE = 'api';

    const config = loadConfigFromEnv();
    expect(config.authMethod).toBe('token');
    expect(config.gitAuthMode).toBe('credential_helper');
    expect(config.oauthClientId).toBe('my-client-id');
    expect(config.oauthClientSecret).toBe('my-secret');
    expect(config.oauthScope).toBe('api');
  });

  test('reads misc config from environment', () => {
    process.env.GITLAB_URL = 'https://gitlab.com';
    process.env.LOG_LEVEL = 'DEBUG';
    process.env.LOG_FILE = '/tmp/log.txt';
    process.env.REPORT_JSON = '/tmp/report.json';

    const config = loadConfigFromEnv();
    expect(config.logLevel).toBe('DEBUG');
    expect(config.logFile).toBe('/tmp/log.txt');
    expect(config.reportJson).toBe('/tmp/report.json');
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
