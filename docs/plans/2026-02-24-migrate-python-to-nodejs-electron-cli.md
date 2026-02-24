# Migrate Python Backend to Native Node.js (Electron + CLI)

## Overview

Replace the entire Python backend (gitlab_downloader/) with native Node.js modules. The Electron app will use these modules directly via IPC instead of HTTP REST calls. A separate lightweight CLI tool will also be created using the same core library, but packaged independently without Electron dependencies.

## Context

- Files involved: electron/main.js, electron/preload.js, electron/src/App.js, electron/src/components/*.js, electron/src/services/api.js, electron/package.json, electron/webpack.config.js, electron/electron-builder.config.js
- New directories: lib/ (shared core library), cli/ (standalone CLI)
- Related patterns: Existing async patterns in Python (semaphore concurrency, retry with backoff, graceful shutdown)
- Dependencies: simple-git, axios, js-yaml, commander, inquirer, chalk, dotenv, zod

## Architecture

```
gitlab-dump/
├── lib/                        # Shared Node.js core library (no Electron deps)
│   ├── package.json
│   ├── index.js
│   ├── client.js               # GitLab API client (pagination, retry, rate limit)
│   ├── cloner.js               # Git clone/pull with concurrency control
│   ├── auth.js                 # OAuth device flow + token auth
│   ├── migration.js            # Git author/committer rewriting (filter-branch)
│   ├── author-mapper.js        # Author mapping load/save (JSON/YAML)
│   ├── config.js               # Configuration model + validation
│   ├── constants.js            # Default values and limits
│   ├── utils.js                # Path sanitization, URL building, credential stripping
│   └── reporting.js            # Summary/dry-run/JSON report generation
├── cli/                        # Standalone CLI (no Electron dependency)
│   ├── package.json
│   ├── bin/
│   │   └── gitlab-dump.js      # CLI entry point
│   ├── index.js                # CLI logic (arg parsing, interactive mode)
│   └── ui.js                   # Terminal UI (prompts, tables, colored output)
├── electron/                   # Electron GUI (uses lib/ directly)
│   ├── main.js                 # Main process (IPC handlers calling lib/)
│   ├── preload.js              # IPC bridge (updated channels)
│   ├── src/
│   │   ├── App.js              # Updated to use IPC instead of HTTP
│   │   ├── components/         # Updated components (no HTTP fetch)
│   │   └── styles/             # CSS (unchanged)
│   ├── package.json            # Updated deps (remove axios, add lib ref)
│   └── ...
```

Communication changes:
- OLD: Renderer -> HTTP fetch -> Python API -> Python modules
- NEW: Renderer -> IPC (preload) -> Main process -> lib/ modules directly

## Development Approach

- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Setup project structure and shared library scaffolding

**Files:**
- Create: `lib/package.json`
- Create: `lib/index.js`
- Create: `lib/constants.js`
- Create: `lib/config.js`
- Create: `lib/utils.js`
- Create: `cli/package.json`
- Create: `cli/bin/gitlab-dump.js`

- [x] Create lib/ directory with package.json (name: @gitlab-dump/core, type: module)
- [x] Port constants.js from Python constants.py (all defaults, limits)
- [x] Port config.js: GitlabConfig class with validation (zod schema), env loading (dotenv), URL validation
- [x] Port utils.js: trimPrefix, sanitizePathComponent, extractGroupPath, isSubpath, sanitizeGitOutput, buildAuthenticatedCloneUrl
- [x] Create lib/index.js re-exporting all modules
- [x] Create cli/ directory with package.json (name: gitlab-dump-cli, bin entry)
- [x] Create cli/bin/gitlab-dump.js as placeholder entry point
- [x] Write tests for constants, config, utils
- [x] Run tests - must pass before task 2

### Task 2: GitLab API client

**Files:**
- Create: `lib/client.js`

- [x] Implement fetchJson(): single HTTP request with retry logic (exponential backoff with jitter, max 120s)
- [x] Implement fetchPaginated(): pagination with per_page param and Link header parsing
- [x] Implement rate limit handling: parse RateLimit-Remaining/Reset headers, calculate delay
- [x] Implement fetchGroupMetadata(): get group info by ID or path (URL-encode path)
- [x] Implement getAllProjects(): recursive BFS traversal of group/subgroups, collect all projects
- [x] Implement getUserProjects(): fetch projects accessible to current user
- [x] Add timeout support (default 30s) using AbortController
- [x] Retry on 429 and 5xx status codes (default 3 retries)
- [x] Write tests with mocked HTTP responses
- [x] Run tests - must pass before task 3

### Task 3: Authentication (OAuth device flow + token)

**Files:**
- Create: `lib/auth.js`

- [x] Implement token-based auth: simple passthrough of GITLAB_TOKEN
- [x] Implement OAuth Device Flow (RFC 8628): deviceAuthorize(), pollDeviceToken(), refreshToken()
- [x] Token cache: read/write to ~/.config/gitlab-dump/oauth_token.json with 0o600 permissions
- [x] Cache validation: check instance URL, client ID, scope match; auto-refresh expired tokens
- [x] resolveAccessToken(): main entry point that chooses token vs oauth based on config
- [x] Handle slow_down response during polling (increase interval)
- [x] Write tests for auth flows (mock OAuth endpoints)
- [x] Run tests - must pass before task 4

### Task 4: Git clone/pull operations

**Files:**
- Create: `lib/cloner.js`

- [x] Implement runGitCommand(): execute git via child_process.spawn with output capture
- [x] Implement cloneRepository(): clone single repo (with retry, backoff)
- [x] Implement cloneAllRepositories(): concurrent cloning with concurrency limit (p-limit or custom semaphore)
- [x] Implement buildCloneTarget(): calculate target directory preserving group structure
- [x] Two git auth modes: url mode (oauth2:token@ in URL) and credential_helper mode
- [x] Update existing repos with git pull --ff-only
- [x] Path validation to prevent directory traversal
- [x] Sanitize git output to remove credentials
- [x] Graceful shutdown support via AbortController
- [x] Write tests for clone operations (mock git commands)
- [x] Run tests - must pass before task 5

### Task 5: Migration and author mapping

**Files:**
- Create: `lib/migration.js`
- Create: `lib/author-mapper.js`

- [ ] Port AuthorMapper: load/save mappings from JSON/YAML files (js-yaml)
- [ ] Port MigrationExecutor: git filter-branch with --env-filter for author/committer rewriting
- [ ] Generate bash env-filter script with proper shell escaping
- [ ] Combined author+committer pass to preserve backup refs
- [ ] Config file discovery (JSON/YAML/YML)
- [ ] Progress callback support for UI updates (EventEmitter pattern)
- [ ] 1 hour timeout for filter-branch operations
- [ ] Secure file permissions (0o600) for config files
- [ ] Write tests for mapping and migration logic
- [ ] Run tests - must pass before task 6

### Task 6: Reporting

**Files:**
- Create: `lib/reporting.js`

- [ ] Implement printSummary(): success/updated/skipped/failed statistics
- [ ] Implement printDryRun(): tabular preview of planned operations
- [ ] Implement writeJsonReport(): write JSON report file (generated_at, group, projects_count, summary, results)
- [ ] Write tests for reporting functions
- [ ] Run tests - must pass before task 7

### Task 7: Standalone CLI application

**Files:**
- Create: `cli/index.js`
- Create: `cli/ui.js`
- Modify: `cli/bin/gitlab-dump.js`
- Modify: `cli/package.json`

- [ ] CLI argument parsing with commander: --url, --token, --group, --clone-path, --dry-run, --update, --interactive, --interactive-menu, --concurrency, --version, --help
- [ ] Port interactive mode: prompt for missing values using inquirer
- [ ] Port interactive menu: clone/migrate/history/exit using inquirer
- [ ] Port clone wizard: connection setup, group selection, clone execution
- [ ] Port migration wizard: repo selection, author mapping, execution with progress
- [ ] Port history view: list completed migrations
- [ ] Colored terminal output with chalk
- [ ] .env file support with dotenv
- [ ] Write tests for CLI argument parsing and core workflows
- [ ] Run tests - must pass before task 8

### Task 8: Rewrite Electron main process (IPC handlers)

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `electron/env.js`
- Modify: `electron/package.json`

- [ ] Remove all Python backend spawning, health check, and process management code from main.js
- [ ] Add IPC handlers that call lib/ modules directly:
  - get-repos: call findGitRepos() to scan clone path
  - get-config / save-config: call authorMapper load/save
  - start-migration: call migrationExecutor, send progress via IPC events
  - get-clone-path: read from env/config
- [ ] Update preload.js: replace HTTP-based channels with new IPC channels
  - Remove: getApiEndpoint, getApiToken, checkApiStatus
  - Add: getRepos(clonePath), startMigration(config), onMigrationProgress(callback), saveAuthorMappings(mappings), getAuthorMappings(), getConfig(repoPath), saveConfig(config)
- [ ] Remove API token generation and HTTP-related code
- [ ] Update electron/package.json: add lib/ dependency, remove axios
- [ ] Update electron-builder.config.js: remove Python binary embedding
- [ ] Write tests for IPC handlers
- [ ] Run tests - must pass before task 9

### Task 9: Rewrite Electron renderer (React components)

**Files:**
- Modify: `electron/src/App.js`
- Modify: `electron/src/components/RepoList.js`
- Modify: `electron/src/components/MigrationWizard.js`
- Modify: `electron/src/components/AuthorMapper.js`
- Modify: `electron/src/components/ProgressIndicator.js`
- Delete: `electron/src/services/api.js`

- [ ] Update App.js: remove apiEndpoint/apiToken state, remove health check polling, simplify initialization
- [ ] Update RepoList.js: replace HTTP fetch with window.electronAPI.getRepos(clonePath)
- [ ] Update MigrationWizard.js: replace HTTP POST with window.electronAPI.startMigration(config), listen for progress via window.electronAPI.onMigrationProgress()
- [ ] Update AuthorMapper.js: replace HTTP calls with window.electronAPI.saveAuthorMappings() / getAuthorMappings()
- [ ] Update ProgressIndicator.js: replace HTTP polling with IPC event listener (window.electronAPI.onMigrationProgress)
- [ ] Delete electron/src/services/api.js (no longer needed)
- [ ] Verify all components work with new IPC-based communication
- [ ] Write/update tests for React components
- [ ] Run tests - must pass before task 10

### Task 10: Update build and packaging configuration

**Files:**
- Modify: `electron/package.json`
- Modify: `electron/webpack.config.js`
- Modify: `electron/electron-builder.config.js`
- Modify: `Makefile`
- Delete: `electron/scripts/prepare-python-dist.js`

- [ ] Remove all Python build scripts from electron/package.json (build-python, embed-python, prebuild-portable)
- [ ] Update electron-builder.config.js: remove extraResources for python_binary
- [ ] Delete electron/scripts/prepare-python-dist.js
- [ ] Update Makefile: add targets for lib tests, cli tests, cli build; remove python-specific targets where replaced
- [ ] Add npm workspace config or update package references
- [ ] Verify electron build works without Python: npm run build && npm run dist
- [ ] Run full test suite
- [ ] Run tests - must pass before task 11

### Task 11: Verify acceptance criteria

- [ ] Manual test: run CLI clone with --dry-run against a real GitLab group
- [ ] Manual test: run CLI clone to actually clone repositories
- [ ] Manual test: launch Electron app, verify repo list loads
- [ ] Manual test: run migration wizard in Electron, verify author rewriting works
- [ ] Manual test: verify Electron build produces distributable without Python
- [ ] Run full test suite (lib, cli, electron)
- [ ] Run linter
- [ ] Verify test coverage meets 80%+

### Task 12: Update documentation

- [ ] Update electron/README.md: remove Python backend references, document new architecture
- [ ] Update CLAUDE.md: update project structure, remove Python API references, add lib/ and cli/ sections
- [ ] Update root README.MD: update installation and usage for Node.js CLI
- [ ] Update root README.en.md: same changes in English
- [ ] Move this plan to `docs/plans/completed/`
