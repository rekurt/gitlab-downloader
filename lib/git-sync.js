import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGitCommand } from './cloner.js';
import { withGitAskPass } from './git-auth.js';
import { redactSecrets, stripUrlCredentials } from './utils.js';

const DESTINATION_REF_PREFIX = 'refs/gitlab-dump/destination/';

async function withOptionalGitAuth(token, operation) {
  if (token) return withGitAskPass(token, operation);
  return operation({ GIT_TERMINAL_PROMPT: '0' });
}

function repositoryUrl(connection, fullPath) {
  if (!connection?.url || !fullPath) return undefined;
  return `${connection.url.replace(/\/$/, '')}/${fullPath.replace(/^\//, '')}.git`;
}

function resolveInput(input, options) {
  return {
    sourceUrl: stripUrlCredentials(
      input.sourceUrl ?? repositoryUrl(options.source, input.sourceFullPath),
    ),
    destinationUrl: stripUrlCredentials(
      input.destinationUrl ?? repositoryUrl(options.destination, input.destinationFullPath),
    ),
    sourceToken: input.sourceToken ?? options.source?.token,
    destinationToken: input.destinationToken ?? options.destination?.token,
  };
}

function parseRefs(output, prefix = '') {
  const refs = new Map();
  for (const line of output.split('\n')) {
    if (!line) continue;
    const separator = line.indexOf(' ');
    if (separator === -1) continue;
    const name = line.slice(0, separator);
    const sha = line.slice(separator + 1);
    refs.set(prefix ? `refs/${prefix}/${name.slice(DESTINATION_REF_PREFIX.length + prefix.length + 1)}` : name, sha);
  }
  return refs;
}

function commandError(args, result, secrets) {
  const detail = redactSecrets(result.stderr || result.stdout || 'unknown Git error', secrets);
  return new Error(`Git command failed (${args.slice(1, 4).join(' ')}): ${detail}`);
}

async function runChecked(runGit, args, options, secrets) {
  const result = await runGit(args, options);
  if (result.code !== 0) throw commandError(args, result, secrets);
  return result;
}

async function listSourceRefs(runGit, mirrorPath, signal, secrets) {
  const result = await runChecked(
    runGit,
    [
      'git', '-C', mirrorPath, 'for-each-ref',
      '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags',
    ],
    { signal },
    secrets,
  );
  return parseRefs(result.stdout);
}

async function listDestinationRefs(runGit, mirrorPath, signal, secrets) {
  const result = await runChecked(
    runGit,
    [
      'git', '-C', mirrorPath, 'for-each-ref',
      '--format=%(refname) %(objectname)',
      `${DESTINATION_REF_PREFIX}heads`, `${DESTINATION_REF_PREFIX}tags`,
    ],
    { signal },
    secrets,
  );
  const refs = new Map();
  for (const [name, sha] of parseRefs(result.stdout)) {
    const destinationName = name.replace(DESTINATION_REF_PREFIX, 'refs/');
    refs.set(destinationName, sha);
  }
  return refs;
}

async function isAncestor(runGit, mirrorPath, ancestor, descendant, signal) {
  const result = await runGit(
    ['git', '-C', mirrorPath, 'merge-base', '--is-ancestor', ancestor, descendant],
    { signal },
  );
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw commandError(['git', 'merge-base', '--is-ancestor'], result, []);
}

async function syncLfs(runGit, mirrorPath, input, signal, secrets) {
  const version = await runGit(['git', 'lfs', 'version'], { signal });
  if (version.code !== 0) {
    return { status: 'unavailable', message: 'git-lfs is not installed' };
  }

  const fetched = await withOptionalGitAuth(input.sourceToken, (env) =>
    runGit(['git', '-C', mirrorPath, 'lfs', 'fetch', '--all', 'origin'], { signal, env }),
  );
  if (fetched.code !== 0) {
    return {
      status: 'failed',
      message: redactSecrets(fetched.stderr || 'Unable to fetch LFS objects', secrets),
    };
  }

  const pushed = await withOptionalGitAuth(input.destinationToken, (env) =>
    runGit(['git', '-C', mirrorPath, 'lfs', 'push', '--all', 'destination'], { signal, env }),
  );
  if (pushed.code !== 0) {
    return {
      status: 'failed',
      message: redactSecrets(pushed.stderr || 'Unable to push LFS objects', secrets),
    };
  }
  return { status: 'finished' };
}

/**
 * Safely copy Git refs from source to destination.
 *
 * New refs are created and existing branches are updated only when the source
 * commit is a proven fast-forward of the destination commit. Conflicting tags
 * and divergent branches are reported and left untouched. No ref is deleted
 * and no force push is performed.
 */
async function syncSingleRepository(input, options = {}) {
  const {
    signal,
    includeLfs = true,
    runGit = runGitCommand,
    onEvent = () => {},
  } = options;
  const resolved = resolveInput(input, options);
  if (!resolved.sourceUrl || !resolved.destinationUrl) {
    throw new Error('Both source and destination repository URLs are required');
  }
  if (resolved.sourceUrl === resolved.destinationUrl) {
    throw new Error('Source and destination repositories must be different');
  }

  const secrets = [resolved.sourceToken, resolved.destinationToken];
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'gitlab-dump-sync-'));
  const mirrorPath = join(temporaryRoot, 'repository.git');

  try {
    onEvent({ phase: 'git_sync', status: 'running', progress: 0 });
    await withOptionalGitAuth(resolved.sourceToken, (env) =>
      runChecked(
        runGit,
        ['git', 'clone', '--mirror', resolved.sourceUrl, mirrorPath],
        { signal, env },
        secrets,
      ),
    );
    await runChecked(
      runGit,
      ['git', '-C', mirrorPath, 'remote', 'add', 'destination', resolved.destinationUrl],
      { signal },
      secrets,
    );
    await withOptionalGitAuth(resolved.destinationToken, (env) =>
      runChecked(
        runGit,
        [
          'git', '-C', mirrorPath, 'fetch', '--no-tags', 'destination',
          `+refs/heads/*:${DESTINATION_REF_PREFIX}heads/*`,
          `+refs/tags/*:${DESTINATION_REF_PREFIX}tags/*`,
        ],
        { signal, env },
        secrets,
      ),
    );

    const sourceRefs = await listSourceRefs(runGit, mirrorPath, signal, secrets);
    const destinationRefs = await listDestinationRefs(runGit, mirrorPath, signal, secrets);
    const pushed = [];
    const unchanged = [];
    const conflicts = [];

    for (const [refName, sourceSha] of [...sourceRefs].sort(([left], [right]) => left.localeCompare(right))) {
      const destinationSha = destinationRefs.get(refName);
      let canPush = destinationSha === undefined;
      if (destinationSha === sourceSha) {
        unchanged.push(refName);
        continue;
      }
      if (destinationSha !== undefined && refName.startsWith('refs/heads/')) {
        canPush = await isAncestor(runGit, mirrorPath, destinationSha, sourceSha, signal);
      }
      if (!canPush) {
        conflicts.push(refName);
        continue;
      }

      await withOptionalGitAuth(resolved.destinationToken, (env) =>
        runChecked(
          runGit,
          ['git', '-C', mirrorPath, 'push', 'destination', `${refName}:${refName}`],
          { signal, env },
          secrets,
        ),
      );
      pushed.push(refName);
      onEvent({
        phase: 'git_sync',
        status: 'running',
        progress: sourceRefs.size ? (pushed.length + unchanged.length + conflicts.length) / sourceRefs.size : 1,
        message: `Processed ${refName}`,
      });
    }

    const lfs = includeLfs
      ? await syncLfs(runGit, mirrorPath, resolved, signal, secrets)
      : { status: 'skipped' };
    const status = conflicts.length > 0 || !['finished', 'skipped'].includes(lfs.status)
      ? 'partial'
      : 'finished';
    onEvent({ phase: 'git_sync', status, progress: 1 });
    return { status, pushed, unchanged, conflicts, lfs };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function remoteHasRefs(url, token, options) {
  const runGit = options.runGit ?? runGitCommand;
  const result = await withOptionalGitAuth(token, (env) =>
    runGit(['git', 'ls-remote', '--heads', '--tags', stripUrlCredentials(url)], {
      signal: options.signal,
      env,
    }),
  );
  if (result.code === 0) return Boolean(result.stdout.trim());
  const detail = redactSecrets(result.stderr || result.stdout || 'unknown Git error', [token]);
  if (/\b404\b|repository[^\n]*not found|project[^\n]*not found/i.test(detail)) return false;
  throw new Error(`Unable to inspect the source wiki repository: ${detail}`);
}

export async function syncRepository(input, options = {}) {
  const main = await syncSingleRepository(input, options);
  if (!input.sourceFullPath || options.includeWiki === false) return main;

  const resolved = resolveInput(input, options);
  const sourceWikiUrl = repositoryUrl(options.source, `${input.sourceFullPath}.wiki`);
  const destinationWikiUrl = repositoryUrl(options.destination, `${input.destinationFullPath}.wiki`);
  if (!sourceWikiUrl || !destinationWikiUrl) return main;
  let sourceWikiExists;
  try {
    sourceWikiExists = await remoteHasRefs(sourceWikiUrl, resolved.sourceToken, options);
  } catch (error) {
    return {
      ...main,
      status: 'partial',
      wiki: { status: 'failed', message: error.message },
    };
  }
  if (!sourceWikiExists) {
    return { ...main, wiki: { status: 'skipped', reason: 'Source wiki repository does not exist' } };
  }

  const wiki = await syncSingleRepository({
    sourceUrl: sourceWikiUrl,
    destinationUrl: destinationWikiUrl,
    sourceToken: resolved.sourceToken,
    destinationToken: resolved.destinationToken,
  }, {
    ...options,
    includeLfs: false,
    includeWiki: false,
  });
  return {
    ...main,
    status: main.status === 'finished' && wiki.status === 'finished' ? 'finished' : 'partial',
    wiki,
  };
}
