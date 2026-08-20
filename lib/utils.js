import { resolve, sep } from 'node:path';

/**
 * Remove a prefix from a path string. Both are normalized (leading/trailing slashes stripped).
 * @param {string} value
 * @param {string} prefix
 * @returns {string}
 */
export function trimPrefix(value, prefix) {
  const normalizedValue = value.replace(/^\/+|\/+$/g, '');
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
  if (normalizedPrefix && normalizedValue.startsWith(normalizedPrefix)) {
    const rest = normalizedValue.slice(normalizedPrefix.length);
    if (!rest || rest.startsWith('/')) {
      return rest.replace(/^\/+|\/+$/g, '');
    }
  }
  return normalizedValue;
}

/**
 * Sanitize a path component by removing dangerous characters and traversal attempts.
 * @param {string} value
 * @returns {string}
 */
export function sanitizePathComponent(value) {
  let cleaned = value.replace(/\\/g, '/').replace(/\x00/g, '');
  cleaned = Array.from(cleaned)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('');
  const parts = cleaned.split('/').filter((part) => part && part !== '.' && part !== '..');
  return parts.join('/');
}

/**
 * Extract the group path relative to the root group from a full path_with_namespace.
 * @param {string} rootFullPath
 * @param {string} pathWithNamespace
 * @returns {string}
 */
export function extractGroupPath(rootFullPath, pathWithNamespace) {
  const parent = pathWithNamespace.includes('/')
    ? pathWithNamespace.slice(0, pathWithNamespace.lastIndexOf('/'))
    : '';
  return trimPrefix(parent, rootFullPath);
}

/**
 * Check if targetPath is under basePath (prevents directory traversal).
 * @param {string} basePath
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isSubpath(basePath, targetPath) {
  const baseResolved = resolve(basePath);
  const targetResolved = resolve(targetPath);
  return targetResolved.startsWith(baseResolved + sep) || targetResolved === baseResolved;
}

/**
 * Remove credentials from git command output.
 * Strips oauth2:token@, user:password@ patterns from URLs in the text.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeGitOutput(text) {
  return text.replace(/:\/\/[^@/\s]+@/g, '://***@');
}

/**
 * Remove credentials from an HTTP(S) remote URL without changing SSH remotes.
 * @param {string} remoteUrl
 * @returns {string}
 */
export function stripUrlCredentials(remoteUrl) {
  try {
    const parsed = new URL(remoteUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return remoteUrl;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return remoteUrl;
  }
}

/**
 * Redact URL credentials and known literal secrets from diagnostic text.
 * @param {string} text
 * @param {Array<string|null|undefined>} [secrets]
 * @returns {string}
 */
export function redactSecrets(text, secrets = []) {
  let result = sanitizeGitOutput(String(text));
  const literals = secrets.filter(Boolean).map(String).sort((a, b) => b.length - a.length);
  for (const secret of literals) result = result.split(secret).join('***');
  return result;
}
