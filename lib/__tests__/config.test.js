import { describe, expect, test } from '@jest/globals';

import {
  GitlabConfigSchema,
  parseConfig,
  validateGitlabUrl,
} from '../config.js';

describe('GitlabConfigSchema', () => {
  test('normalizes a minimal clone configuration', () => {
    expect(parseConfig({ url: 'https://gitlab.example.com///', token: 'secret' })).toMatchObject({
      url: 'https://gitlab.example.com',
      token: 'secret',
      maxConcurrency: 5,
      updateExisting: false,
    });
  });

  test('rejects legacy OAuth, credential-helper, and migration fields', () => {
    for (const field of ['oauthCachePath', 'gitAuthMode', 'target_token']) {
      expect(() => GitlabConfigSchema.parse({
        url: 'https://gitlab.example.com',
        [field]: 'legacy',
      })).toThrow();
    }
  });
});

test('validateGitlabUrl accepts only HTTP(S) URLs with a host', () => {
  expect(validateGitlabUrl('https://gitlab.example.com')).toBe(true);
  expect(validateGitlabUrl('https://oauth2:secret@gitlab.example.com')).toBe(false);
  expect(validateGitlabUrl('https://gitlab.example.com?private_token=secret')).toBe(false);
  expect(() => parseConfig({
    url: 'https://oauth2:secret@gitlab.example.com',
    token: 'runtime-secret',
  })).toThrow(/credentials/i);
  expect(validateGitlabUrl('file:///tmp/repository')).toBe(false);
  expect(validateGitlabUrl('not a URL')).toBe(false);
});
