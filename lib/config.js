import { z } from 'zod';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  DEFAULT_CLONE_PATH,
  DEFAULT_PER_PAGE,
  DEFAULT_TIMEOUT,
  DEFAULT_API_RETRIES,
  DEFAULT_CLONE_RETRIES,
  DEFAULT_CONCURRENCY,
  MIN_CONCURRENCY,
  MAX_CONCURRENCY,
} from './constants.js';

export const GitlabConfigSchema = z.object({
  url: z
    .string()
    .min(1)
    .refine(
      (val) => {
        try {
          const u = new URL(val);
          return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
        } catch {
          return false;
        }
      },
      { message: 'Invalid GitLab URL: expected http(s)://host' }
    )
    .transform((val) => val.replace(/\/+$/, '')),
  token: z.string().nullable().default(null),
  group: z.string().nullable().default(null),
  clonePath: z.string().min(1).default(DEFAULT_CLONE_PATH),
  perPage: z.number().int().positive().default(DEFAULT_PER_PAGE),
  requestTimeout: z.number().int().positive().default(DEFAULT_TIMEOUT),
  maxRetries: z.number().int().min(1).default(DEFAULT_API_RETRIES),
  cloneRetries: z.number().int().min(0).default(DEFAULT_CLONE_RETRIES),
  maxConcurrency: z
    .number()
    .int()
    .min(MIN_CONCURRENCY)
    .max(MAX_CONCURRENCY)
    .default(DEFAULT_CONCURRENCY),
  dryRun: z.boolean().default(false),
  updateExisting: z.boolean().default(false),
  logLevel: z.string().default('INFO'),
  logFile: z.string().nullable().default(null),
  interactive: z.boolean().default(false),
  interactiveMenu: z.boolean().default(false),
  reportJson: z.string().nullable().default(null),
  authMethod: z.enum(['token', 'oauth']).default('oauth'),
  gitAuthMode: z.enum(['url', 'credential_helper']).default('url'),
  oauthClientId: z.string().nullable().default(null),
  oauthClientSecret: z.string().nullable().default(null),
  oauthScope: z.string().default('read_api read_repository'),
  oauthCachePath: z
    .string()
    .default(resolve(homedir(), '.config', 'gitlab-dump', 'oauth_token.json')),
});

/**
 * Validate a GitLab URL string.
 * @param {string} url
 * @returns {boolean}
 */
export function validateGitlabUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * Parse an environment variable as integer with default fallback.
 * @param {string} name
 * @param {number} defaultValue
 * @returns {number}
 */
function envInt(name, defaultValue) {
  const val = process.env[name];
  if (val === undefined || val === '') return defaultValue;
  const parsed = parseInt(val, 10);
  if (Number.isNaN(parsed)) {
    console.warn(`Invalid integer for ${name}: '${val}', using default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse an environment variable as boolean.
 * @param {string} name
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function envBool(name, defaultValue = false) {
  const val = process.env[name];
  if (val === undefined || val === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(val.trim().toLowerCase());
}

/**
 * Read OAuth client ID from cached token file if it matches the given instance URL.
 * @param {string|null} cachePath
 * @param {string|null} gitlabUrl
 * @returns {string|null}
 */
function cachedOauthClientId(cachePath, gitlabUrl) {
  if (!cachePath || !gitlabUrl) return null;
  try {
    const resolved = resolve(cachePath.replace(/^~/, homedir()));
    const payload = JSON.parse(readFileSync(resolved, 'utf-8'));
    const cachedUrl = String(payload.instance_url || '').replace(/\/+$/, '');
    if (cachedUrl !== gitlabUrl.replace(/\/+$/, '')) return null;
    const clientId = payload.client_id;
    if (typeof clientId === 'string' && clientId.trim()) return clientId.trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * Load configuration from environment variables (with optional .env file).
 * Returns a raw config object suitable for passing to GitlabConfigSchema.parse().
 * @param {object} [options]
 * @param {string} [options.envPath] - Path to .env file (default: auto-detect)
 * @returns {object}
 */
export function loadConfigFromEnv(options = {}) {
  if (options.envPath) {
    dotenv.config({ path: options.envPath });
  } else {
    dotenv.config();
  }

  const url = process.env.GITLAB_URL || '';
  const oauthCachePath =
    process.env.GITLAB_OAUTH_CACHE_PATH ||
    resolve(homedir(), '.config', 'gitlab-dump', 'oauth_token.json');

  let oauthClientId = process.env.GITLAB_OAUTH_CLIENT_ID || null;
  if (!oauthClientId) {
    oauthClientId = cachedOauthClientId(oauthCachePath, url);
  }

  return {
    url,
    token: process.env.GITLAB_TOKEN || null,
    group: process.env.GITLAB_GROUP || null,
    clonePath: process.env.CLONE_PATH || DEFAULT_CLONE_PATH,
    perPage: envInt('PER_PAGE', DEFAULT_PER_PAGE),
    requestTimeout: envInt('REQUEST_TIMEOUT', DEFAULT_TIMEOUT),
    maxRetries: envInt('MAX_RETRIES', DEFAULT_API_RETRIES),
    cloneRetries: envInt('CLONE_RETRIES', DEFAULT_CLONE_RETRIES),
    maxConcurrency: envInt('MAX_CONCURRENCY', DEFAULT_CONCURRENCY),
    dryRun: envBool('DRY_RUN', false),
    updateExisting: envBool('UPDATE_EXISTING', false),
    logLevel: process.env.LOG_LEVEL || 'INFO',
    logFile: process.env.LOG_FILE || null,
    interactive: envBool('INTERACTIVE', false),
    interactiveMenu: envBool('INTERACTIVE_MENU', false),
    reportJson: process.env.REPORT_JSON || null,
    authMethod: process.env.AUTH_METHOD || 'oauth',
    gitAuthMode: process.env.GIT_AUTH_MODE || 'url',
    oauthClientId,
    oauthClientSecret: process.env.GITLAB_OAUTH_CLIENT_SECRET || null,
    oauthScope: process.env.GITLAB_OAUTH_SCOPE || 'read_api read_repository',
    oauthCachePath,
  };
}

/**
 * Parse and validate config from a raw object.
 * @param {object} raw
 * @returns {z.infer<typeof GitlabConfigSchema>}
 */
export function parseConfig(raw) {
  return GitlabConfigSchema.parse(raw);
}
