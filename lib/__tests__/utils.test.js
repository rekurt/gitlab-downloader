import { jest } from '@jest/globals';
import {
  trimPrefix,
  sanitizePathComponent,
  extractGroupPath,
  sanitizeGitOutput,
  stripUrlCredentials,
  redactSecrets,
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

describe('stripUrlCredentials', () => {
  test('removes username and password while preserving host, port, and path', () => {
    expect(
      stripUrlCredentials('https://oauth2:secret@gitlab.example.com:8443/group/repo.git'),
    ).toBe('https://gitlab.example.com:8443/group/repo.git');
  });

  test('leaves SSH remotes unchanged', () => {
    expect(stripUrlCredentials('git@gitlab.example.com:group/repo.git')).toBe(
      'git@gitlab.example.com:group/repo.git',
    );
  });
});

describe('redactSecrets', () => {
  test('removes both URL credentials and literal secret values', () => {
    const text = 'token abc-123; remote https://oauth2:abc-123@gitlab.example.com/repo.git';
    const result = redactSecrets(text, ['abc-123']);
    expect(result).toBe('token ***; remote https://***@gitlab.example.com/repo.git');
  });
});
