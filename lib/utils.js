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
 * Build an authenticated HTTPS clone URL with oauth2:token@host format.
 * @param {string} httpsUrl
 * @param {string} token
 * @returns {string}
 */
export function buildAuthenticatedCloneUrl(httpsUrl, token) {
  const parsed = new URL(httpsUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid repository URL');
  }
  if (!parsed.hostname) {
    throw new Error('Invalid repository URL');
  }
  const encodedToken = encodeURIComponent(token);
  parsed.username = 'oauth2';
  parsed.password = encodedToken;
  return parsed.toString();
}
