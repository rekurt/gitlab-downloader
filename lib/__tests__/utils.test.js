import { jest } from '@jest/globals';
import {
  trimPrefix,
  sanitizePathComponent,
  extractGroupPath,
  sanitizeGitOutput,
  buildAuthenticatedCloneUrl,
} from '../utils.js';

describe('trimPrefix', () => {
  test('removes matching prefix', () => {
    expect(trimPrefix('group/subgroup/project', 'group')).toBe('subgroup/project');
  });

  test('handles leading/trailing slashes', () => {
    expect(trimPrefix('/group/subgroup/project/', '/group/')).toBe('subgroup/project');
  });

  test('returns normalized value when prefix does not match', () => {
    expect(trimPrefix('other/project', 'group')).toBe('other/project');
  });

  test('returns empty string when value equals prefix', () => {
    expect(trimPrefix('group', 'group')).toBe('');
  });

  test('handles empty prefix', () => {
    expect(trimPrefix('group/project', '')).toBe('group/project');
  });

  test('handles empty value', () => {
    expect(trimPrefix('', 'group')).toBe('');
  });

  test('does not match partial prefix', () => {
    expect(trimPrefix('group-other/project', 'group')).toBe('group-other/project');
  });

  test('handles nested path with matching prefix', () => {
    expect(trimPrefix('a/b/c/d', 'a/b')).toBe('c/d');
  });
});

describe('sanitizePathComponent', () => {
  test('removes null bytes', () => {
    expect(sanitizePathComponent('foo\x00bar')).toBe('foobar');
  });

  test('removes dot-dot traversal', () => {
    expect(sanitizePathComponent('foo/../bar')).toBe('foo/bar');
  });

  test('removes single dot components', () => {
    expect(sanitizePathComponent('foo/./bar')).toBe('foo/bar');
  });

  test('converts backslashes to forward slashes', () => {
    expect(sanitizePathComponent('foo\\bar\\baz')).toBe('foo/bar/baz');
  });

  test('removes control characters', () => {
    expect(sanitizePathComponent('foo\x01bar\x7f')).toBe('foobar');
  });

  test('removes empty path segments', () => {
    expect(sanitizePathComponent('foo//bar///baz')).toBe('foo/bar/baz');
  });

  test('handles normal path', () => {
    expect(sanitizePathComponent('group/subgroup/project')).toBe('group/subgroup/project');
  });
});

describe('extractGroupPath', () => {
  test('extracts relative group path', () => {
    expect(extractGroupPath('root-group', 'root-group/sub/project')).toBe('sub');
  });

  test('handles project at root level', () => {
    expect(extractGroupPath('root-group', 'root-group/project')).toBe('');
  });

  test('handles deeply nested path', () => {
    expect(extractGroupPath('root', 'root/a/b/c/project')).toBe('a/b/c');
  });

  test('handles project without namespace', () => {
    expect(extractGroupPath('root', 'project')).toBe('');
  });
});

describe('sanitizeGitOutput', () => {
  test('removes oauth2:token@ from URLs', () => {
    expect(sanitizeGitOutput('Cloning into https://oauth2:secret-token@gitlab.com/repo.git')).toBe(
      'Cloning into https://***@gitlab.com/repo.git'
    );
  });

  test('removes user:password@ from URLs', () => {
    expect(sanitizeGitOutput('fatal: https://user:pass@gitlab.com/repo.git')).toBe(
      'fatal: https://***@gitlab.com/repo.git'
    );
  });

  test('does not modify URLs without credentials', () => {
    const text = 'Cloning into https://gitlab.com/repo.git';
    expect(sanitizeGitOutput(text)).toBe(text);
  });

  test('handles multiple URLs in same text', () => {
    const text =
      'https://oauth2:token1@host1.com/a and https://user:pass@host2.com/b';
    expect(sanitizeGitOutput(text)).toBe(
      'https://***@host1.com/a and https://***@host2.com/b'
    );
  });
});

describe('buildAuthenticatedCloneUrl', () => {
  test('adds oauth2:token to https URL', () => {
    const result = buildAuthenticatedCloneUrl('https://gitlab.com/group/project.git', 'my-token');
    expect(result).toBe('https://oauth2:my-token@gitlab.com/group/project.git');
  });

  test('encodes special characters in token', () => {
    const result = buildAuthenticatedCloneUrl(
      'https://gitlab.com/group/project.git',
      'token/with@special'
    );
    expect(result).toContain('oauth2:');
    expect(result).toContain('gitlab.com');
    // Token should be URL-encoded
    expect(result).not.toContain('token/with@special');
    expect(result).toContain(encodeURIComponent('token/with@special'));
  });

  test('preserves port in URL', () => {
    const result = buildAuthenticatedCloneUrl(
      'https://gitlab.example.com:8443/group/project.git',
      'token'
    );
    expect(result).toContain(':8443');
    expect(result).toContain('oauth2:token@');
  });

  test('throws on invalid protocol', () => {
    expect(() => buildAuthenticatedCloneUrl('ftp://gitlab.com/repo.git', 'token')).toThrow(
      'Invalid repository URL'
    );
  });

  test('works with http URL', () => {
    const result = buildAuthenticatedCloneUrl('http://gitlab.local/group/project.git', 'token');
    expect(result).toMatch(/^http:\/\/oauth2:token@gitlab\.local/);
  });
});
