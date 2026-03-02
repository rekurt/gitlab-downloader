import { jest } from '@jest/globals';
import {
  GITLAB_API_VERSION,
  DEFAULT_CLONE_PATH,
  DEFAULT_PER_PAGE,
  DEFAULT_TIMEOUT,
  DEFAULT_API_RETRIES,
  DEFAULT_CLONE_RETRIES,
  DEFAULT_CONCURRENCY,
  MIN_CONCURRENCY,
  MAX_CONCURRENCY,
  RETRY_BACKOFF_MAX,
} from '../constants.js';

describe('constants', () => {
  test('GITLAB_API_VERSION is v4', () => {
    expect(GITLAB_API_VERSION).toBe('v4');
  });

  test('DEFAULT_CLONE_PATH is repositories', () => {
    expect(DEFAULT_CLONE_PATH).toBe('repositories');
  });

  test('DEFAULT_PER_PAGE is 100', () => {
    expect(DEFAULT_PER_PAGE).toBe(100);
  });

  test('DEFAULT_TIMEOUT is 30', () => {
    expect(DEFAULT_TIMEOUT).toBe(30);
  });

  test('DEFAULT_API_RETRIES is 3', () => {
    expect(DEFAULT_API_RETRIES).toBe(3);
  });

  test('DEFAULT_CLONE_RETRIES is 2', () => {
    expect(DEFAULT_CLONE_RETRIES).toBe(2);
  });

  test('DEFAULT_CONCURRENCY is 5', () => {
    expect(DEFAULT_CONCURRENCY).toBe(5);
  });

  test('MIN_CONCURRENCY is 1', () => {
    expect(MIN_CONCURRENCY).toBe(1);
  });

  test('MAX_CONCURRENCY is 50', () => {
    expect(MAX_CONCURRENCY).toBe(50);
  });

  test('RETRY_BACKOFF_MAX is 120', () => {
    expect(RETRY_BACKOFF_MAX).toBe(120);
  });

  test('concurrency range is valid', () => {
    expect(MIN_CONCURRENCY).toBeLessThan(MAX_CONCURRENCY);
    expect(DEFAULT_CONCURRENCY).toBeGreaterThanOrEqual(MIN_CONCURRENCY);
    expect(DEFAULT_CONCURRENCY).toBeLessThanOrEqual(MAX_CONCURRENCY);
  });
});
