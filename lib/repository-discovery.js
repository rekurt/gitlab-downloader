import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { stripUrlCredentials } from './utils.js';

function originUrl(gitDirectory) {
  try {
    const config = readFileSync(join(gitDirectory, 'config'), 'utf8');
    const match = config.match(/\[remote "origin"\][^[]*?^\s*url\s*=\s*(.+)$/m);
    return match ? stripUrlCredentials(match[1].trim()) : '';
  } catch {
    return '';
  }
}

function lastUpdated(gitDirectory) {
  for (const name of ['FETCH_HEAD', 'HEAD']) {
    try {
      return statSync(join(gitDirectory, name)).mtime.toISOString();
    } catch {
      // Try the next safe metadata file.
    }
  }
  return null;
}

export function findGitRepositories(basePath, maxDepth = 10) {
  if (!basePath || !existsSync(basePath)) return [];
  const repositories = [];
  const walk = (directory, depth) => {
    if (depth > maxDepth) return;
    try {
      const gitDirectory = join(directory, '.git');
      if (existsSync(gitDirectory)) {
        repositories.push({
          name: basename(directory),
          path: directory,
          url: originUrl(gitDirectory),
          last_updated: lastUpdated(gitDirectory),
        });
        return;
      }
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(join(directory, entry.name), depth + 1);
      }
    } catch {
      // Unreadable directories and broken links are outside the discovery result.
    }
  };
  walk(basePath, 0);
  return repositories.sort((left, right) => left.path.localeCompare(right.path));
}
