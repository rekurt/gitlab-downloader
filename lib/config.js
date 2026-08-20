import { z } from 'zod';

import {
  DEFAULT_API_RETRIES,
  DEFAULT_CLONE_PATH,
  DEFAULT_CLONE_RETRIES,
  DEFAULT_CONCURRENCY,
  DEFAULT_PER_PAGE,
  DEFAULT_TIMEOUT,
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
} from './constants.js';

export const GitlabConfigSchema = z
  .object({
    url: z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'Invalid GitLab URL: expected http(s)://host',
    }).refine((value) => {
      const parsed = new URL(value);
      return !parsed.username && !parsed.password;
    }, {
      message: 'GitLab URLs must not contain embedded credentials',
    }).refine((value) => {
      const parsed = new URL(value);
      return !parsed.search && !parsed.hash;
    }, {
      message: 'GitLab URLs must not contain a query or fragment',
    }).transform((value) => value.replace(/\/+$/, '')),
    token: z.string().min(1).nullable().default(null),
    group: z.string().min(1).nullable().default(null),
    clonePath: z.string().min(1).default(DEFAULT_CLONE_PATH),
    perPage: z.number().int().positive().default(DEFAULT_PER_PAGE),
    requestTimeout: z.number().int().positive().default(DEFAULT_TIMEOUT),
    maxRetries: z.number().int().min(1).default(DEFAULT_API_RETRIES),
    cloneRetries: z.number().int().min(0).default(DEFAULT_CLONE_RETRIES),
    maxConcurrency: z.number().int().min(MIN_CONCURRENCY).max(MAX_CONCURRENCY).default(DEFAULT_CONCURRENCY),
    dryRun: z.boolean().default(false),
    updateExisting: z.boolean().default(false),
  })
  .strict();

export function validateGitlabUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      Boolean(parsed.hostname) && !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

export function parseConfig(raw) {
  return GitlabConfigSchema.parse(raw);
}
