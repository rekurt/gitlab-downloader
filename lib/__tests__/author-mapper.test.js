import { jest } from '@jest/globals';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadMappings,
  saveMappings,
  loadMigrationConfig,
  saveMigrationConfig,
  discoverConfig,
  saveConfigToRepo,
  validateConfigData,
  CONFIG_FILENAMES,
} from '../author-mapper.js';

let tmpDir;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'author-mapper-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── helpers ────────────────────────────────────────────────────────

function sampleAuthorMappings() {
  return {
    user1: {
      original_name: 'Old Name',
      original_email: 'old@example.com',
      new_name: 'New Name',
      new_email: 'new@example.com',
    },
  };
}

function sampleCommitterMappings() {
  return {
    committer1: {
      original_name: 'Committer Old',
      original_email: 'cold@example.com',
      new_name: 'Committer New',
      new_email: 'cnew@example.com',
    },
  };
}

function fullConfig() {
  return {
    source_repos_path: '/repos',
    target_hosting_url: 'https://gitlab.example.com',
    target_token: 'secret-token',
    author_mappings: sampleAuthorMappings(),
    committer_mappings: sampleCommitterMappings(),
  };
}

// ─── CONFIG_FILENAMES ───────────────────────────────────────────────

describe('CONFIG_FILENAMES', () => {
  test('contains expected filenames in order', () => {
    expect(CONFIG_FILENAMES).toEqual([
      'migration_config.json',
      'migration_config.yaml',
      'migration_config.yml',
    ]);
  });
});

// ─── loadMappings ───────────────────────────────────────────────────

describe('loadMappings', () => {
  test('loads mappings from JSON file', async () => {
    const filePath = join(tmpDir, 'config.json');
    const data = {
      author_mappings: sampleAuthorMappings(),
      committer_mappings: sampleCommitterMappings(),
    };
    await writeFile(filePath, JSON.stringify(data));

    const result = await loadMappings(filePath);
    expect(result.authorMappings).toEqual(sampleAuthorMappings());
    expect(result.committerMappings).toEqual(sampleCommitterMappings());
  });

  test('loads mappings from YAML file', async () => {
    const filePath = join(tmpDir, 'config.yaml');
    const yamlContent = `author_mappings:
  user1:
    original_name: Old Name
    original_email: old@example.com
    new_name: New Name
    new_email: new@example.com
committer_mappings: {}
`;
    await writeFile(filePath, yamlContent);

    const result = await loadMappings(filePath);
    expect(result.authorMappings.user1.original_name).toBe('Old Name');
    expect(result.committerMappings).toEqual({});
  });

  test('loads mappings from YML file', async () => {
    const filePath = join(tmpDir, 'config.yml');
    const yamlContent = `author_mappings:
  user1:
    original_name: Test
    original_email: test@test.com
    new_name: New
    new_email: new@test.com
`;
    await writeFile(filePath, yamlContent);

    const result = await loadMappings(filePath);
    expect(result.authorMappings.user1.original_name).toBe('Test');
  });

  test('throws for non-existent file', async () => {
    await expect(loadMappings(join(tmpDir, 'nope.json'))).rejects.toThrow('Config file not found');
  });

  test('throws for unsupported format', async () => {
    const filePath = join(tmpDir, 'config.toml');
    await writeFile(filePath, 'data = 1');
    await expect(loadMappings(filePath)).rejects.toThrow('Unsupported config file format');
  });

  test('throws for non-object root', async () => {
    const filePath = join(tmpDir, 'config.json');
    await writeFile(filePath, '"not an object"');
    await expect(loadMappings(filePath)).rejects.toThrow('must contain an object');
  });

  test('returns empty mappings when sections are missing', async () => {
    const filePath = join(tmpDir, 'config.json');
    await writeFile(filePath, '{}');

    const result = await loadMappings(filePath);
    expect(result.authorMappings).toEqual({});
    expect(result.committerMappings).toEqual({});
  });

  test('skips entries with empty original name and email', async () => {
    const filePath = join(tmpDir, 'config.json');
    const data = {
      author_mappings: {
        valid: {
          original_name: 'Name',
          original_email: 'email@test.com',
          new_name: 'New',
          new_email: 'new@test.com',
        },
        invalid: {
          original_name: '',
          original_email: '',
          new_name: 'X',
          new_email: 'x@test.com',
        },
      },
    };
    await writeFile(filePath, JSON.stringify(data));

    const result = await loadMappings(filePath);
    expect(Object.keys(result.authorMappings)).toEqual(['valid']);
  });

  test('skips non-object mapping entries', async () => {
    const filePath = join(tmpDir, 'config.json');
    const data = {
      author_mappings: {
        valid: {
          original_name: 'Name',
          original_email: 'email@test.com',
          new_name: 'New',
          new_email: 'new@test.com',
        },
        bad_string: 'not an object',
        bad_array: [1, 2, 3],
      },
    };
    await writeFile(filePath, JSON.stringify(data));

    const result = await loadMappings(filePath);
    expect(Object.keys(result.authorMappings)).toEqual(['valid']);
  });

  test('defaults missing fields to empty string', async () => {
    const filePath = join(tmpDir, 'config.json');
    const data = {
      author_mappings: {
        user1: {
          original_name: 'Name',
          original_email: 'e@e.com',
          // new_name and new_email missing
        },
      },
    };
    await writeFile(filePath, JSON.stringify(data));

    const result = await loadMappings(filePath);
    expect(result.authorMappings.user1.new_name).toBe('');
    expect(result.authorMappings.user1.new_email).toBe('');
  });
});

// ─── saveMappings ───────────────────────────────────────────────────

describe('saveMappings', () => {
  test('saves mappings to JSON file', async () => {
    const filePath = join(tmpDir, 'out.json');
    await saveMappings(filePath, sampleAuthorMappings(), sampleCommitterMappings());

    const content = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(content.author_mappings.user1.original_name).toBe('Old Name');
    expect(content.committer_mappings.committer1.original_name).toBe('Committer Old');
  });

  test('saves mappings to YAML file', async () => {
    const filePath = join(tmpDir, 'out.yaml');
    await saveMappings(filePath, sampleAuthorMappings(), {});

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('Old Name');
  });

  test('preserves existing migration fields', async () => {
    const filePath = join(tmpDir, 'existing.json');
    const existing = {
      source_repos_path: '/repos',
      target_hosting_url: 'https://gitlab.com',
      target_token: 'tok',
      author_mappings: {},
    };
    await writeFile(filePath, JSON.stringify(existing));

    await saveMappings(filePath, sampleAuthorMappings(), {});

    const content = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(content.source_repos_path).toBe('/repos');
    expect(content.target_hosting_url).toBe('https://gitlab.com');
    expect(content.target_token).toBe('tok');
    expect(content.author_mappings.user1.original_name).toBe('Old Name');
  });

  test('creates parent directories if needed', async () => {
    const filePath = join(tmpDir, 'sub', 'dir', 'config.json');
    await saveMappings(filePath, {}, {});

    const content = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(content.author_mappings).toEqual({});
  });

  test('writes file with restricted permissions', async () => {
    const filePath = join(tmpDir, 'secure.json');
    await saveMappings(filePath, {}, {});

    const fileStat = await stat(filePath);
    const mode = fileStat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('throws for unsupported format', async () => {
    const filePath = join(tmpDir, 'out.toml');
    await expect(saveMappings(filePath, {}, {})).rejects.toThrow('Unsupported config file format');
  });
});

// ─── loadMigrationConfig ────────────────────────────────────────────

describe('loadMigrationConfig', () => {
  test('loads complete config from JSON', async () => {
    const filePath = join(tmpDir, 'migration.json');
    await writeFile(filePath, JSON.stringify(fullConfig()));

    const config = await loadMigrationConfig(filePath);
    expect(config.source_repos_path).toBe('/repos');
    expect(config.target_hosting_url).toBe('https://gitlab.example.com');
    expect(config.target_token).toBe('secret-token');
    expect(config.author_mappings.user1.original_name).toBe('Old Name');
    expect(config.committer_mappings.committer1.original_name).toBe('Committer Old');
  });

  test('loads complete config from YAML', async () => {
    const filePath = join(tmpDir, 'migration.yaml');
    const yamlContent = `source_repos_path: /repos
target_hosting_url: https://gitlab.example.com
target_token: secret-token
author_mappings:
  user1:
    original_name: Old Name
    original_email: old@example.com
    new_name: New Name
    new_email: new@example.com
committer_mappings: {}
`;
    await writeFile(filePath, yamlContent);

    const config = await loadMigrationConfig(filePath);
    expect(config.source_repos_path).toBe('/repos');
    expect(config.author_mappings.user1.new_name).toBe('New Name');
  });

  test('throws for missing required fields', async () => {
    const filePath = join(tmpDir, 'partial.json');
    await writeFile(filePath, JSON.stringify({ source_repos_path: '/repos' }));

    await expect(loadMigrationConfig(filePath)).rejects.toThrow('Missing required fields');
  });

  test('throws for non-existent file', async () => {
    await expect(loadMigrationConfig(join(tmpDir, 'nope.json'))).rejects.toThrow(
      'Config file not found'
    );
  });
});

// ─── saveMigrationConfig ────────────────────────────────────────────

describe('saveMigrationConfig', () => {
  test('saves and reloads complete config (JSON)', async () => {
    const filePath = join(tmpDir, 'save-test.json');
    const config = fullConfig();
    await saveMigrationConfig(filePath, config);

    const loaded = await loadMigrationConfig(filePath);
    expect(loaded.source_repos_path).toBe(config.source_repos_path);
    expect(loaded.target_token).toBe(config.target_token);
    expect(loaded.author_mappings).toEqual(config.author_mappings);
  });

  test('saves and reloads complete config (YAML)', async () => {
    const filePath = join(tmpDir, 'save-test.yaml');
    const config = fullConfig();
    await saveMigrationConfig(filePath, config);

    const loaded = await loadMigrationConfig(filePath);
    expect(loaded.source_repos_path).toBe(config.source_repos_path);
  });

  test('writes with restricted permissions', async () => {
    const filePath = join(tmpDir, 'secure-config.json');
    await saveMigrationConfig(filePath, fullConfig());

    const fileStat = await stat(filePath);
    const mode = fileStat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

// ─── discoverConfig ─────────────────────────────────────────────────

describe('discoverConfig', () => {
  test('discovers JSON config', async () => {
    await writeFile(join(tmpDir, 'migration_config.json'), JSON.stringify(fullConfig()));

    const config = await discoverConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config.source_repos_path).toBe('/repos');
  });

  test('discovers YAML config when no JSON', async () => {
    const yamlContent = `source_repos_path: /repos
target_hosting_url: https://gitlab.example.com
target_token: tok
author_mappings: {}
committer_mappings: {}
`;
    await writeFile(join(tmpDir, 'migration_config.yaml'), yamlContent);

    const config = await discoverConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config.source_repos_path).toBe('/repos');
  });

  test('discovers YML config when no JSON or YAML', async () => {
    const yamlContent = `source_repos_path: /data
target_hosting_url: https://gitlab.example.com
target_token: tok
author_mappings: {}
committer_mappings: {}
`;
    await writeFile(join(tmpDir, 'migration_config.yml'), yamlContent);

    const config = await discoverConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config.source_repos_path).toBe('/data');
  });

  test('prefers JSON over YAML', async () => {
    await writeFile(
      join(tmpDir, 'migration_config.json'),
      JSON.stringify({ ...fullConfig(), source_repos_path: '/json' })
    );
    const yamlContent = `source_repos_path: /yaml
target_hosting_url: https://gitlab.example.com
target_token: tok
author_mappings: {}
committer_mappings: {}
`;
    await writeFile(join(tmpDir, 'migration_config.yaml'), yamlContent);

    const config = await discoverConfig(tmpDir);
    expect(config.source_repos_path).toBe('/json');
  });

  test('returns null when no config files exist', async () => {
    const config = await discoverConfig(tmpDir);
    expect(config).toBeNull();
  });
});

// ─── saveConfigToRepo ───────────────────────────────────────────────

describe('saveConfigToRepo', () => {
  test('saves JSON config to repo directory', async () => {
    await saveConfigToRepo(tmpDir, fullConfig(), 'json');

    const filePath = join(tmpDir, 'migration_config.json');
    const content = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(content.source_repos_path).toBe('/repos');
  });

  test('saves YAML config to repo directory', async () => {
    await saveConfigToRepo(tmpDir, fullConfig(), 'yaml');

    const filePath = join(tmpDir, 'migration_config.yaml');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('source_repos_path');
  });

  test('defaults to JSON format', async () => {
    await saveConfigToRepo(tmpDir, fullConfig());

    const filePath = join(tmpDir, 'migration_config.json');
    const content = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(content.source_repos_path).toBe('/repos');
  });

  test('throws for unsupported format', async () => {
    await expect(saveConfigToRepo(tmpDir, fullConfig(), 'toml')).rejects.toThrow(
      'Unsupported format'
    );
  });
});

// ─── validateConfigData ─────────────────────────────────────────────

describe('validateConfigData', () => {
  test('validates correct config', () => {
    const data = {
      source_repos_path: '/repos',
      target_hosting_url: 'https://gitlab.com',
      target_token: 'tok',
    };
    expect(validateConfigData(data)).toBe(data);
  });

  test('validates config with mappings', () => {
    const data = {
      source_repos_path: '/repos',
      target_hosting_url: 'https://gitlab.com',
      target_token: 'tok',
      author_mappings: {
        user1: {
          original_name: 'A',
          original_email: 'a@a.com',
          new_name: 'B',
          new_email: 'b@b.com',
        },
      },
    };
    expect(validateConfigData(data)).toBe(data);
  });

  test('throws for missing required fields', () => {
    expect(() => validateConfigData({ source_repos_path: '/repos' })).toThrow(
      'Missing required fields'
    );
  });

  test('throws for non-object data', () => {
    expect(() => validateConfigData(null)).toThrow('must be an object');
    expect(() => validateConfigData('string')).toThrow('must be an object');
    expect(() => validateConfigData([1, 2])).toThrow('must be an object');
  });

  test('throws for non-object mapping section', () => {
    const data = {
      source_repos_path: '/repos',
      target_hosting_url: 'https://gitlab.com',
      target_token: 'tok',
      author_mappings: 'not an object',
    };
    expect(() => validateConfigData(data)).toThrow('author_mappings must be an object');
  });

  test('throws for non-object mapping entry', () => {
    const data = {
      source_repos_path: '/repos',
      target_hosting_url: 'https://gitlab.com',
      target_token: 'tok',
      author_mappings: {
        user1: 'not an object',
      },
    };
    expect(() => validateConfigData(data)).toThrow('author_mappings.user1 must be an object');
  });

  test('throws for missing mapping fields', () => {
    const data = {
      source_repos_path: '/repos',
      target_hosting_url: 'https://gitlab.com',
      target_token: 'tok',
      author_mappings: {
        user1: {
          original_name: 'A',
          // missing other fields
        },
      },
    };
    expect(() => validateConfigData(data)).toThrow('is missing field');
  });
});
