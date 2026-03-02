import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { load as yamlParse, dump as yamlStringify } from 'js-yaml';

/**
 * @typedef {object} AuthorMapping
 * @property {string} original_name
 * @property {string} original_email
 * @property {string} new_name
 * @property {string} new_email
 */

/**
 * @typedef {object} CommitterMapping
 * @property {string} original_name
 * @property {string} original_email
 * @property {string} new_name
 * @property {string} new_email
 */

/**
 * @typedef {object} MigrationConfig
 * @property {string} source_repos_path
 * @property {string} target_hosting_url
 * @property {string} target_token
 * @property {Record<string, AuthorMapping>} author_mappings
 * @property {Record<string, CommitterMapping>} committer_mappings
 */

const MIGRATION_FIELDS = ['source_repos_path', 'target_hosting_url', 'target_token'];
const MAPPING_FIELDS = ['original_name', 'original_email', 'new_name', 'new_email'];

/**
 * Config filenames searched in order for auto-discovery.
 */
export const CONFIG_FILENAMES = [
  'migration_config.json',
  'migration_config.yaml',
  'migration_config.yml',
];

/**
 * Parse raw data into a mapping dictionary.
 *
 * @param {*} data - Raw mapping section from config file
 * @param {string} label - Mapping type label for warnings (e.g., "author", "committer")
 * @returns {Record<string, AuthorMapping|CommitterMapping>}
 */
function parseMappings(data, _label) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    try {
      const original_name = String(value.original_name ?? '');
      const original_email = String(value.original_email ?? '');
      const new_name = String(value.new_name ?? '');
      const new_email = String(value.new_email ?? '');
      if (!original_name && !original_email) {
        continue;
      }
      result[key] = { original_name, original_email, new_name, new_email };
    } catch {
      // skip malformed entries
    }
  }
  return result;
}

/**
 * Serialize mapping objects into plain dictionaries for storage.
 *
 * @param {Record<string, AuthorMapping|CommitterMapping>} mappings
 * @returns {Record<string, object>}
 */
function serializeMappings(mappings) {
  const result = {};
  for (const [key, m] of Object.entries(mappings)) {
    result[key] = {
      original_name: m.original_name,
      original_email: m.original_email,
      new_name: m.new_name,
      new_email: m.new_email,
    };
  }
  return result;
}

/**
 * Detect file format from extension.
 *
 * @param {string} filePath
 * @returns {'json'|'yaml'}
 */
function detectFormat(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  if (ext === '.json') return 'json';
  throw new Error(`Unsupported config file format: ${ext}`);
}

/**
 * Parse file content based on format.
 *
 * @param {string} content - File content
 * @param {'json'|'yaml'} format
 * @returns {*}
 */
function parseContent(content, format) {
  if (format === 'json') return JSON.parse(content);
  return yamlParse(content);
}

/**
 * Serialize data to string based on format.
 *
 * @param {object} data
 * @param {'json'|'yaml'} format
 * @returns {string}
 */
function serializeContent(data, format) {
  if (format === 'json') return JSON.stringify(data, null, 2) + '\n';
  return yamlStringify(data, { lineWidth: -1 });
}

/**
 * Write a file with restricted permissions (0o600).
 *
 * @param {string} filePath
 * @param {string} content
 */
async function writeSecure(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Check if a file exists.
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── AuthorMapper ───────────────────────────────────────────────────

/**
 * Load author and committer mappings from a config file (JSON or YAML).
 *
 * @param {string} configPath - Path to JSON/YAML config file
 * @returns {Promise<{authorMappings: Record<string, AuthorMapping>, committerMappings: Record<string, CommitterMapping>}>}
 */
export async function loadMappings(configPath) {
  if (!(await fileExists(configPath))) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const format = detectFormat(configPath);
  const content = await readFile(configPath, 'utf-8');
  const data = parseContent(content, format);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Config file must contain an object');
  }
  const authorMappings = parseMappings(data.author_mappings, 'author');
  const committerMappings = parseMappings(data.committer_mappings, 'committer');
  return { authorMappings, committerMappings };
}

/**
 * Save author and committer mappings to a config file.
 * Preserves existing migration fields (source_repos_path, etc.) if the file exists.
 *
 * @param {string} configPath
 * @param {Record<string, AuthorMapping>} authorMappings
 * @param {Record<string, CommitterMapping>} committerMappings
 */
export async function saveMappings(configPath, authorMappings, committerMappings) {
  const format = detectFormat(configPath);
  const data = {
    author_mappings: serializeMappings(authorMappings),
    committer_mappings: serializeMappings(committerMappings),
  };

  // Preserve existing migration config fields if file exists
  if (await fileExists(configPath)) {
    try {
      const existingContent = await readFile(configPath, 'utf-8');
      const existingData = parseContent(existingContent, format);
      if (existingData && typeof existingData === 'object' && !Array.isArray(existingData)) {
        for (const field of MIGRATION_FIELDS) {
          if (existingData[field] !== undefined) {
            data[field] = existingData[field];
          }
        }
      }
    } catch {
      // If existing file can't be read/parsed, just write new data
    }
  }

  const serialized = serializeContent(data, format);
  await writeSecure(configPath, serialized);
}

// ─── MigrationConfig loading ────────────────────────────────────────

/**
 * Load a complete migration config from a file.
 *
 * @param {string} configPath
 * @returns {Promise<MigrationConfig>}
 */
export async function loadMigrationConfig(configPath) {
  if (!(await fileExists(configPath))) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const format = detectFormat(configPath);
  const content = await readFile(configPath, 'utf-8');
  const data = parseContent(content, format);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Config file must contain an object');
  }
  const missing = MIGRATION_FIELDS.filter((f) => !data[f]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
  return {
    source_repos_path: data.source_repos_path,
    target_hosting_url: data.target_hosting_url,
    target_token: data.target_token,
    author_mappings: parseMappings(data.author_mappings, 'author'),
    committer_mappings: parseMappings(data.committer_mappings, 'committer'),
  };
}

/**
 * Save a complete migration config to a file.
 *
 * @param {string} configPath
 * @param {MigrationConfig} config
 */
export async function saveMigrationConfig(configPath, config) {
  const format = detectFormat(configPath);
  const data = {
    source_repos_path: config.source_repos_path,
    target_hosting_url: config.target_hosting_url,
    target_token: config.target_token,
    author_mappings: serializeMappings(config.author_mappings),
    committer_mappings: serializeMappings(config.committer_mappings),
  };
  const serialized = serializeContent(data, format);
  await writeSecure(configPath, serialized);
}

// ─── Config file discovery ──────────────────────────────────────────

/**
 * Discover and load a migration config from a repository directory.
 * Searches for CONFIG_FILENAMES in order and returns the first valid one found.
 *
 * @param {string} repoPath - Repository directory path
 * @returns {Promise<MigrationConfig|null>} - Null if no config file found
 */
export async function discoverConfig(repoPath) {
  for (const filename of CONFIG_FILENAMES) {
    const filePath = join(repoPath, filename);
    if (await fileExists(filePath)) {
      return loadMigrationConfig(filePath);
    }
  }
  return null;
}

/**
 * Save a migration config to a repository directory.
 *
 * @param {string} repoPath
 * @param {MigrationConfig} config
 * @param {'json'|'yaml'} [format='json']
 */
export async function saveConfigToRepo(repoPath, config, format = 'json') {
  if (format !== 'json' && format !== 'yaml') {
    throw new Error(`Unsupported format: ${format}. Must be "json" or "yaml"`);
  }
  const filename = `migration_config.${format}`;
  const filePath = join(repoPath, filename);
  await saveMigrationConfig(filePath, config);
}

/**
 * Validate a migration config data object.
 *
 * @param {object} data
 * @returns {object} - The validated data (unchanged)
 */
export function validateConfigData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Config data must be an object');
  }
  const missing = MIGRATION_FIELDS.filter((f) => !data[f]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
  for (const section of ['author_mappings', 'committer_mappings']) {
    if (data[section]) {
      if (typeof data[section] !== 'object' || Array.isArray(data[section])) {
        throw new Error(`${section} must be an object`);
      }
      for (const [key, value] of Object.entries(data[section])) {
        if (typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`${section}.${key} must be an object`);
        }
        for (const field of MAPPING_FIELDS) {
          if (value[field] === undefined) {
            throw new Error(`${section}.${key} is missing field: ${field}`);
          }
        }
      }
    }
  }
  return data;
}
