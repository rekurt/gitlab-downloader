# GitLab Dump 0.2 — Engineering Reference

This file is the canonical contributor reference. User-facing behavior and limitations are documented in [README.md](README.md) and [README.ru.md](README.ru.md).

## Architecture

The repository is one npm workspace with a single lockfile and three packages:

```text
lib/       @gitlab-dump/core: schemas and plain async functions
cli/       gitlab-dump command-line shell
electron/  sandboxed Electron/React shell
```

Both shells call the same core API. There is no service/controller/repository layer and no renderer-side GitLab or filesystem access.

Important core entry points:

- `planTransfer(input)` returns a schema-versioned, credential-free `TransferPlan`;
- `executeTransfer(plan, options)`, `getTransferStatus(runId)`, and `cancelTransfer(runId)` implement the transfer lifecycle;
- `syncRepository(input)` performs conservative Git ref/wiki/LFS synchronization;
- `previewHistoryRewrite(input)` and `rewriteHistory(input)` operate on separate mirrors;
- `findGitRepositories(path)` is shared local repository discovery.

Transfer entities use exactly one mode: `direct_transfer`, `git_sync`, `git_only_fallback`, or `blocked`. Events use the shared `TransferEvent` schema.

## Toolchain and commands

Node.js 24 and npm 11 are required. Dependency versions are exact in `package-lock.json`.

```bash
npm ci
npm run lint
npm test
npm run test:coverage
npm run build
npm run pack
npm audit --omit=dev --audit-level=high
```

The equivalent Make targets are `install`, `lint`, `test`, `coverage`, `build`, `pack`, `audit`, and `ci`.

Workspace-specific checks can be run with `npm test --workspace <package-name>` and `npm run lint --workspace <package-name>`.

## CLI contract

The 0.1 invocation without a subcommand is intentionally unsupported:

```text
gitlab-dump clone
gitlab-dump transfer plan
gitlab-dump transfer run
gitlab-dump transfer status
gitlab-dump transfer cancel
gitlab-dump rewrite-history
```

PATs come only from `GITLAB_TOKEN`, `GITLAB_SOURCE_TOKEN`, `GITLAB_DESTINATION_TOKEN`, or a masked interactive prompt. Never add token flags or plaintext credential config fields.

CLI state/report files are written atomically with private permissions. Persist only safe IDs, URLs, statuses, and timestamps. Exit codes are `0` success/query, `1` failure, `2` partial/blocked, and `130` canceled.

## Transfer invariants

- GitLab platform transfer requires HTTPS.
- A failed or disconnected `POST /bulk_imports` is ambiguous and must not be retried automatically.
- Resume polls a persisted bulk-import ID instead of issuing another POST.
- Existing GitLab metadata, issues, merge requests, and wikis are never manually merged.
- Git-sync creates missing refs, fast-forwards proven branches, leaves divergent branches/conflicting tags unchanged, and never deletes or force-pushes refs.
- Git-only fallback creates empty group/project skeletons and transfers Git/wiki/LFS data only. Do not describe it as a full migration.
- Reports enumerate supported, skipped, conflicting, and failed entities and preserve safe correlation IDs/relation failures.
- The source is read-only.

`lib/gitlab-api.js` contains the HTTP contract. GET/HEAD requests may retry transient failures; state-changing requests do not. Every HTTP request and poll must honor an `AbortSignal` and a timeout.

## History rewrite invariants

- Mapping JSON is strict, schema-versioned, and credential-free.
- `git filter-repo` is mandatory; `git filter-branch` must never be reintroduced.
- Preview and rewrite always use a separate mirror.
- A pre-rewrite Git bundle is mandatory and its recovery command is reported.
- Push requires a fresh preview, the exact confirmation phrase, and one exact `--force-with-lease=<ref>:<old-sha>` per changed ref.
- Never disable protected branches or retry a lease conflict with force.

## Secret handling

- Never put credentials in clone URLs, process arguments, logs, plans, reports, renderer state, or ordinary configuration.
- Git authentication uses a temporary `GIT_ASKPASS`; its helper is deleted in `finally`.
- Credential-bearing legacy origins must be stripped before display or update.
- Electron persists secrets only through `safeStorage`. If OS encryption is unavailable, keep them in the main process memory for the session.
- The OAuth renderer receives only status, verification data, and a safe user profile—never an access token.

Do not print response bodies or command environments when they could contain secrets. Tests include explicit non-leak assertions.

## Electron boundaries

`main.js` is only the composition root. Main-process responsibilities are split into:

- `window-security.js`: sandboxed window, navigation/window denial, application menu;
- `ipc-handlers.js`: narrow validated IPC handlers;
- `operation-registry.js`: independent `AbortController` and ownership per operation;
- `preload.js`: named methods plus one removable operation-event subscription.

Renderer requests carry operation/session/resource IDs issued by the main process. Main validates sender ownership and resolves user-approved paths. Do not add generic `invoke`, `on`, `off`, or `once` bridges.

External OAuth URLs must be HTTPS and match the expected GitLab origin. Cancel and shutdown must stop polling and child Git processes.

## Tests and coverage

Core tests include local fake GitLab HTTP contracts and real temporary Git repositories. CLI tests call both injected command handlers and the actual binary. Electron tests cover IPC ownership/security, OAuth values, secret boundaries, UI result states, subscription cleanup, and a production Webpack build.

Coverage gates:

- core: at least 90% statements/lines, 80% functions/branches;
- CLI and Electron main/renderer: at least 80% statements/lines/functions and 70% branches.

Do not silence React, Ant Design, or jsdom warnings. Fix their source. Generated `dist/`, `dist_electron/`, `coverage/`, and `node_modules/` are not source artifacts.

## Packaging and CI

CI uses `npm ci`, Node 24, lint, coverage, production build, production dependency audit, and unsigned `electron-builder --dir` smoke packaging on Linux, macOS, and Windows. Signing and notarization require release-owner certificates.

The opt-in GitLab smoke workflow receives credentials only from CI secrets and covers Direct Transfer, existing-project Git-sync, cancel/resume, and relation-failure reporting.

## Change checklist

1. Keep `lib` free of Electron dependencies.
2. Validate external input with existing schemas or an equally strict boundary.
3. Add a failing test first for bug fixes and behavior changes.
4. Preserve cancellation, deadlines, redaction, and cleanup in every new operation.
5. Update English and Russian README content when public behavior changes.
6. Run the full root verification commands before merging.
