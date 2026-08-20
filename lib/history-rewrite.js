import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

import { runGitCommand } from './cloner.js';
import { withGitAskPass } from './git-auth.js';
import { redactSecrets, stripUrlCredentials } from './utils.js';

export const HISTORY_REWRITE_CONFIRMATION = 'I UNDERSTAND THAT COMMIT SHAS WILL CHANGE';
export const HISTORY_REWRITE_PREVIEW_MAX_AGE_MS = 5 * 60 * 1_000;

const IdentityNameSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\x00-\x1f\x7f<>]/.test(value), 'Identity name contains invalid characters');
const EmailSchema = z
  .string()
  .email()
  .max(320)
  .refine((value) => !/[\x00-\x1f\x7f<>]/.test(value), 'Email contains invalid characters');

export const HistoryMappingSchema = z
  .object({
    schemaVersion: z.literal(1),
    mappings: z
      .array(
        z
          .object({
            match: z.object({ name: IdentityNameSchema.optional(), email: EmailSchema }).strict(),
            replace: z.object({ name: IdentityNameSchema.optional(), email: EmailSchema }).strict(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const emails = new Set();
    value.mappings.forEach((rule, index) => {
      const email = rule.match.email.toLowerCase();
      if (emails.has(email)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mappings', index, 'match', 'email'],
          message: `Duplicate or ambiguous mapping for ${rule.match.email}`,
        });
      }
      emails.add(email);
    });
  });

export function validateHistoryMapping(rawMapping) {
  return HistoryMappingSchema.parse(rawMapping);
}

export function createMailmap(rawMapping) {
  const mapping = validateHistoryMapping(rawMapping);
  return mapping.mappings
    .map((rule) => {
      const replacementName = rule.replace.name ?? rule.match.name;
      const canonical = `${replacementName ? `${replacementName} ` : ''}<${rule.replace.email}>`;
      const original = `${rule.match.name ? `${rule.match.name} ` : ''}<${rule.match.email}>`;
      return `${canonical} ${original}`;
    })
    .join('\n') + '\n';
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function withOptionalGitAuth(token, operation) {
  if (token) return withGitAskPass(token, operation);
  return operation({ GIT_TERMINAL_PROMPT: '0' });
}

function gitError(args, result, secrets) {
  const detail = redactSecrets(result.stderr || result.stdout || 'unknown Git error', secrets);
  return new Error(`Git command failed (${args.slice(1, 4).join(' ')}): ${detail}`);
}

async function runChecked(runGit, args, options, secrets) {
  const result = await runGit(args, options);
  if (result.code !== 0) throw gitError(args, result, secrets);
  return result;
}

function parseLines(output) {
  return new Set(output.split('\n').map((line) => line.trim()).filter(Boolean));
}

function parseRefSnapshot(output) {
  const refs = new Map();
  for (const line of output.split('\n')) {
    const separator = line.indexOf(' ');
    if (separator > 0) refs.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return refs;
}

async function snapshot(runGit, repository, signal, secrets) {
  const [refs, commits] = await Promise.all([
    runChecked(
      runGit,
      [
        'git', '-C', repository, 'for-each-ref',
        '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags',
      ],
      { signal },
      secrets,
    ),
    runChecked(
      runGit,
      ['git', '-C', repository, 'rev-list', '--all'],
      { signal },
      secrets,
    ),
  ]);
  return { refs: parseRefSnapshot(refs.stdout), commits: parseLines(commits.stdout) };
}

function compareSnapshots(before, after) {
  const changedRefs = [...after.refs]
    .filter(([name, sha]) => before.refs.get(name) !== sha)
    .map(([name]) => name)
    .sort();
  const changedCommits = [...after.commits].filter((sha) => !before.commits.has(sha)).length;
  return { changedRefs, changedCommits };
}

function snapshotFingerprint(snapshot) {
  const serialized = [...snapshot.refs]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, sha]) => `${name}\0${sha}\n`)
    .join('');
  return createHash('sha256').update(serialized).digest('hex');
}

function requireFreshPreview(preview, now) {
  const previewedAt = Date.parse(preview?.createdAt);
  const currentTime = new Date(now).getTime();
  if (
    preview?.status !== 'preview' ||
    !Array.isArray(preview.changedRefs) ||
    !Number.isInteger(preview.changedCommits) ||
    typeof preview.sourceFingerprint !== 'string' ||
    !Number.isFinite(previewedAt) ||
    !Number.isFinite(currentTime) ||
    previewedAt > currentTime ||
    currentTime - previewedAt > HISTORY_REWRITE_PREVIEW_MAX_AGE_MS
  ) {
    throw new Error('Push requires a fresh history-rewrite preview');
  }
  return preview;
}

function previewMatchesChanges(preview, changes) {
  return preview.changedCommits === changes.changedCommits &&
    preview.changedRefs.length === changes.changedRefs.length &&
    preview.changedRefs.every((refName, index) => refName === changes.changedRefs[index]);
}

async function assertFilterRepo(runGit, signal) {
  const result = await runGit(['git', 'filter-repo', '--version'], { signal });
  if (result.code !== 0) {
    throw new Error('git-filter-repo is required; install it and ensure `git filter-repo --version` succeeds');
  }
}

async function cloneMirror(input, output, runGit, signal, secrets) {
  const repository = stripUrlCredentials(input.repository);
  if (!repository) throw new Error('Repository is required');
  await withOptionalGitAuth(input.token, (env) =>
    runChecked(
      runGit,
      ['git', 'clone', '--mirror', repository, output],
      { signal, env },
      secrets,
    ),
  );
  return repository;
}

async function applyMapping(repository, mapping, runGit, signal, secrets) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'gitlab-dump-mailmap-'));
  const mailmapPath = join(temporaryRoot, 'mailmap');
  try {
    await writeFile(mailmapPath, createMailmap(mapping), { mode: 0o600 });
    await runChecked(
      runGit,
      ['git', '-C', repository, 'filter-repo', '--mailmap', mailmapPath, '--force'],
      { signal },
      secrets,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function pushChangedRefs(input, output, sourceRepository, before, changedRefs, runGit, signal, secrets) {
  if (!input.push || changedRefs.length === 0) return [];
  const destinationUrl = stripUrlCredentials(input.destinationUrl ?? sourceRepository);
  await runChecked(
    runGit,
    ['git', '-C', output, 'remote', 'add', 'destination', destinationUrl],
    { signal },
    secrets,
  );
  const pushed = [];
  for (const refName of changedRefs) {
    const expectedSha = before.refs.get(refName);
    if (!expectedSha) throw new Error(`Cannot push ${refName}: no pre-rewrite lease value is available`);
    try {
      await withOptionalGitAuth(input.destinationToken ?? input.token, (env) =>
        runChecked(
          runGit,
          [
            'git', '-C', output, 'push', 'destination',
            `--force-with-lease=${refName}:${expectedSha}`,
            `${refName}:${refName}`,
          ],
          { signal, env },
          secrets,
        ),
      );
    } catch (error) {
      error.pushedRefs = [...pushed];
      throw error;
    }
    pushed.push(refName);
  }
  return pushed;
}

export async function previewHistoryRewrite(input, options = {}) {
  const mapping = validateHistoryMapping(input.mapping);
  const runGit = options.runGit ?? runGitCommand;
  const signal = options.signal;
  const secrets = [input.token, input.destinationToken];
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'gitlab-dump-rewrite-preview-'));
  const mirror = join(temporaryRoot, 'repository.git');
  try {
    await assertFilterRepo(runGit, signal);
    await cloneMirror(input, mirror, runGit, signal, secrets);
    const before = await snapshot(runGit, mirror, signal, secrets);
    await applyMapping(mirror, mapping, runGit, signal, secrets);
    const after = await snapshot(runGit, mirror, signal, secrets);
    return {
      status: 'preview',
      createdAt: new Date((options.now ?? (() => new Date()))()).toISOString(),
      sourceFingerprint: snapshotFingerprint(before),
      ...compareSnapshots(before, after),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function rewriteHistory(input, options = {}) {
  const mapping = validateHistoryMapping(input.mapping);
  if (input.push && input.confirmation !== HISTORY_REWRITE_CONFIRMATION) {
    throw new Error(`Push requires the exact confirmation phrase: ${HISTORY_REWRITE_CONFIRMATION}`);
  }
  const preview = input.push
    ? requireFreshPreview(input.preview, (options.now ?? (() => new Date()))())
    : null;
  if (!input.output) throw new Error('An explicit output directory is required');
  const output = resolve(input.output);
  const backupPath = resolve(input.backupPath ?? `${output}.before-rewrite.bundle`);
  if (await exists(output)) throw new Error(`Output path already exists: ${output}`);
  if (await exists(backupPath)) throw new Error(`Backup path already exists: ${backupPath}`);

  const runGit = options.runGit ?? runGitCommand;
  const signal = options.signal;
  const secrets = [input.token, input.destinationToken];
  await assertFilterRepo(runGit, signal);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(dirname(backupPath), { recursive: true });
  const sourceRepository = await cloneMirror(input, output, runGit, signal, secrets);
  const before = await snapshot(runGit, output, signal, secrets);
  await runChecked(
    runGit,
    ['git', '-C', output, 'bundle', 'create', backupPath, '--all'],
    { signal },
    secrets,
  );
  const recovery = `git clone --mirror ${JSON.stringify(backupPath)} restored.git`;
  let changes = { changedRefs: [], changedCommits: 0 };
  try {
    if (preview && preview.sourceFingerprint !== snapshotFingerprint(before)) {
      throw new Error('Source refs changed since the fresh history-rewrite preview');
    }
    await applyMapping(output, mapping, runGit, signal, secrets);
    const after = await snapshot(runGit, output, signal, secrets);
    changes = compareSnapshots(before, after);
    if (preview && !previewMatchesChanges(preview, changes)) {
      throw new Error('Rewrite changes no longer match the fresh history-rewrite preview');
    }
    const pushedRefs = await pushChangedRefs(
      input,
      output,
      sourceRepository,
      before,
      changes.changedRefs,
      runGit,
      signal,
      secrets,
    );
    return {
      status: 'finished',
      output,
      backupPath,
      recovery,
      ...changes,
      pushedRefs,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: redactSecrets(error.message || String(error), secrets),
      pushedRefs: error.pushedRefs ?? [],
      ...changes,
      output,
      backupPath,
      recovery,
    };
  }
}
