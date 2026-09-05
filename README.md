# GitLab Dump 0.2

[Русская версия](README.ru.md)

GitLab Dump clones repositories and performs conservative transfers between GitLab instances. The CLI and Electron application are thin shells over the same `@gitlab-dump/core` workspace.

[Project website](https://rekurt.github.io/gitlab-downloader/) · [All projects by rekurt](https://rekurt.github.io/projects/)

Version 0.2 intentionally breaks the 0.1 CLI. Every operation now requires an explicit subcommand. PAT flags, PAT-bearing clone URLs, plaintext migration configs, `MigrationExecutor`, and `git filter-branch` are gone.

## Requirements

- Node.js 24 LTS and npm 11.
- Git for clone, Git-sync, and history rewrite.
- `git-lfs` when repositories contain LFS objects.
- `git-filter-repo` for history rewrite.
- Electron 43 for the desktop build.

Node 24 is an Active LTS line through October 2026 ([Node.js release schedule](https://github.com/nodejs/release#release-schedule)). Electron 43 is a supported stable line ([Electron schedule](https://releases.electronjs.org/schedule)).

```bash
npm ci
npm run lint
npm test
npm run build
```

## CLI

```text
gitlab-dump clone
gitlab-dump transfer plan
gitlab-dump transfer run
gitlab-dump transfer status
gitlab-dump transfer cancel
gitlab-dump rewrite-history
```

Use `--help` on each command for its full option list.

### Credentials

PATs are accepted only from:

- `GITLAB_TOKEN` as a shared fallback;
- `GITLAB_SOURCE_TOKEN`;
- `GITLAB_DESTINATION_TOKEN`;
- a masked interactive prompt when the process has a TTY.

There are no token flags. Git authentication uses a temporary `GIT_ASKPASS` helper. Tokens are not added to command arguments, remote URLs, plans, reports, or ordinary configuration files. Legacy credential-bearing HTTP(S) origins are cleaned before an existing clone is updated.

### Clone

```bash
export GITLAB_TOKEN='...'
gitlab-dump clone \
  --url https://gitlab.example.com \
  --group team/platform \
  --clone-path ./repositories \
  --report ./clone-report.json
```

Existing clones are changed only with `--update`, using `git pull --ff-only`.

### Plan and run a transfer

```bash
export GITLAB_SOURCE_TOKEN='...'
export GITLAB_DESTINATION_TOKEN='...'

gitlab-dump transfer plan \
  --source-url https://source.example.com \
  --destination-url https://destination.example.com \
  --source-path team/platform \
  --source-type group \
  --destination-namespace archive \
  --out ./transfer-plan.json

gitlab-dump transfer run \
  --plan ./transfer-plan.json \
  --report ./transfer-report.json
```

A plan is schema-versioned and contains URLs, versions, paths, warnings, reasons, and one mode per entity. It never contains credentials.

| Mode | Meaning |
| --- | --- |
| `direct_transfer` | The destination entity is absent and GitLab Direct Transfer is compatible. |
| `git_sync` | The destination project exists; only conservative Git synchronization is allowed. |
| `git_only_fallback` | Direct Transfer is unavailable; an empty group/project skeleton is created, then Git is synchronized. |
| `blocked` | A preflight requirement failed and the entity is not changed. |

Git-sync creates missing branches and tags and fast-forwards branches only after proving ancestry. Divergent branches and conflicting tags are left unchanged. It never deletes refs or force-pushes. Existing GitLab metadata, issues, merge requests, and wiki pages are not manually merged. A source wiki Git repository and LFS objects are synchronized when present and when the required tools are available.

`transfer run --run-id <id>` resumes polling an already recorded bulk import instead of issuing another ambiguous POST. `transfer status` and `transfer cancel` use a private state file containing only IDs, URLs, status, and timestamps. Cancellation is state-driven; no persisted PID is signaled.

## Direct Transfer compatibility

Preflight checks HTTPS, API access, source/destination versions, destination namespace access, Direct Transfer availability when observable, and local Git tools. GitLab documents these important prerequisites:

- GitLab 16.8 or newer is recommended on both sides.
- The source may not be more than two minor versions behind the destination (with GitLab's documented Dedicated exception).
- Direct Transfer must be enabled on both instances.
- The source PAT needs `api` scope and the account needs the required source/destination roles.

See [GitLab Direct Transfer prerequisites](https://docs.gitlab.com/user/group/import/direct_transfer_migrations/) and the [Bulk Imports API](https://docs.gitlab.com/api/bulk_imports/).

Direct Transfer creates copies. It does not copy every GitLab resource, and users are never created automatically. Membership and contribution mapping follows GitLab's current rules. Review GitLab's [migrated items and limitations](https://docs.gitlab.com/user/group/import/) before production use.

Git-only fallback is not a full GitLab migration. It transfers repository refs, wiki Git data, and LFS data only; it does not transfer runners, CI/CD secrets, registry artifacts, instance data, issues, merge requests, or other platform resources.

## History rewrite

Mapping files are strict and credential-free:

```json
{
  "schemaVersion": 1,
  "mappings": [
    {
      "match": { "name": "Old Name", "email": "old@example.com" },
      "replace": { "name": "New Name", "email": "new@example.com" }
    }
  ]
}
```

Duplicate match emails, unknown fields, invalid emails, and control characters are rejected.

```bash
gitlab-dump rewrite-history \
  --repository ./source.git \
  --mapping ./history-mapping.json \
  --output ./rewritten.git \
  --dry-run

gitlab-dump rewrite-history \
  --repository ./source.git \
  --mapping ./history-mapping.json \
  --output ./rewritten.git
```

The operation always clones a separate mirror, records changed commits/refs, creates a pre-rewrite Git bundle, and then invokes `git filter-repo`. It never rewrites the supplied repository in place.

Recovery is shown in the JSON result and has this form:

```bash
git clone --mirror "/path/to/rewritten.git.before-rewrite.bundle" restored.git
```

`--push` first runs and prints a fresh preview with the changed commit/ref counts, then requires the exact interactive confirmation phrase `I UNDERSTAND THAT COMMIT SHAS WILL CHANGE`. The desktop app likewise refuses a push unless the selected repository and mapping have a successful preview. Every changed ref is pushed separately with an exact `--force-with-lease=<ref>:<old-sha>`. A concurrent update or protected ref stops the operation; branch protection is never disabled automatically.

## Desktop security

The Electron renderer is sandboxed and isolated. Navigation and renderer-created windows are denied. External OAuth pages are opened by the main process only after HTTPS/origin validation. On first load, legacy plaintext token fields from 0.1 settings are migrated into `safeStorage` (or session memory) and immediately removed from the ordinary settings object.

Desktop PATs and OAuth tokens use Electron `safeStorage`. If OS encryption is unavailable, secrets remain in memory for the current session and are not persisted. The renderer receives only `hasToken` flags, operation/resource IDs, safe plans, reports, statuses, and OAuth profile data. It never receives an OAuth access token or arbitrary filesystem authority.

## Reports and exit status

Reports enumerate supported, skipped, and conflicting entities and preserve Direct Transfer correlation IDs and relation failures. Secrets are excluded.

- exit `0`: successful operation or status query;
- exit `1`: failed operation or invalid input;
- exit `2`: partial result or blocked plan;
- exit `130`: canceled operation.

## Development and packaging

```bash
npm run lint
npm run test:coverage
npm run build
npm run pack
npm audit --omit=dev --audit-level=high
```

CI uses `npm ci` and performs unsigned packaging smoke tests on Linux, macOS, and Windows. Code signing and notarization require user-owned certificates and remain a release task.

An opt-in `GitLab opt-in smoke` workflow exercises configured test instances. It requires prepared new-group, existing-project, cancellation, and intentional relation-failure fixtures; credentials come only from protected CI secrets.

## License

MIT
