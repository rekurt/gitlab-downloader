# Gitlab Downloader

Language: **English (additional)** | [Русский (основной)](README.MD)

`Gitlab Downloader` is a utility for fetching and cloning all repositories from a GitLab group and its subgroups while preserving directory hierarchy. Built on Node.js.

## Features
- Recursive group/subgroup traversal.
- Cloning with concurrency limits.
- Retry for API requests and `git clone`.
- Final summary (`success`, `updated`, `skipped`, `failed`).
- `--dry-run` mode to preview operations.
- `--update` mode to run `git pull --ff-only` for existing clones.
- Interactive mode with wizards for cloning and migration.
- OAuth Device Flow for browser-based authorization.
- Author/committer migration via git filter-branch.

## Installation

```bash
# Install dependencies for all components (lib, cli, electron)
make node-install
```

or manually:

```bash
npm install --prefix lib
npm install --prefix cli
npm install --prefix electron
```

## Usage

You can use CLI flags or environment variables (`GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_GROUP`, `CLONE_PATH`).
`GITLAB_GROUP` is optional: if omitted, the tool fetches current user's membership projects.

```bash
node cli/bin/gitlab-dump.js --help
node cli/bin/gitlab-dump.js --version
node cli/bin/gitlab-dump.js --url https://gitlab.com --token <token> --group <group>
node cli/bin/gitlab-dump.js --url https://gitlab.com --token <token>
node cli/bin/gitlab-dump.js --dry-run --url https://gitlab.com --token <token> --group <group>
node cli/bin/gitlab-dump.js --update --url https://gitlab.com --token <token> --group <group>
```

Or via Makefile:
```bash
make cli-run
make cli-dry-run
```

### Interactive Mode

```bash
node cli/bin/gitlab-dump.js --interactive          # Interactive setup
node cli/bin/gitlab-dump.js --interactive-menu     # Full interactive menu (clone/migrate)
```

### OAuth Device Flow
```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --auth-method oauth \
  --oauth-client-id <client_id> \
  --git-auth-mode credential_helper
```
The CLI prints a browser URL and code, then stores access/refresh tokens in cache (`~/.config/gitlab-dump/oauth_token.json` by default).

### Git Credential Helper
For `clone/pull` without token in URL:
```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --auth-method token \
  --token <token> \
  --git-auth-mode credential_helper
```
This mode uses `git credential approve` with your configured `credential.helper`.

## Examples

### Dry-run before cloning
Preview which repositories will be cloned without actually downloading them:

```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token> \
  --group my-group \
  --dry-run
```

The output will show all repositories to be cloned, including their size and last commit info.

### Update existing repositories
If repositories are already cloned, use `--update` to fetch the latest changes:

```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token> \
  --group my-group \
  --update \
  --clone-path ./repositories
```

This runs `git pull --ff-only` for each repository instead of re-cloning.

### Sync from private GitLab instance
Clone repositories from a private GitLab server (e.g., corporate instance):

```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.internal.company.com \
  --token <private-token> \
  --group engineering \
  --clone-path ./internal-repos
```

### Export current user's projects
If you don't need a group, export only projects you have access to:

```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token> \
  --clone-path ./my-projects
```

### OAuth with Git credential helper
Modern approach without explicit token in arguments:

```bash
# First run — prompts for browser login
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --auth-method oauth \
  --oauth-client-id <client_id> \
  --git-auth-mode credential_helper \
  --group frontend-team

# Subsequent runs use cached token
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --git-auth-mode credential_helper \
  --group frontend-team \
  --update
```

### Configuration via environment variables
If you regularly clone the same group, use environment variables:

```bash
export GITLAB_URL=https://gitlab.com
export GITLAB_TOKEN=glpat-xxxxxxxxxxxx
export GITLAB_GROUP=my-organization
export CLONE_PATH=/data/repositories

node cli/bin/gitlab-dump.js --dry-run
node cli/bin/gitlab-dump.js --update
```

### .env configuration file
Create a `.env` file in your project directory:

```bash
# .env
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=glpat-your-token-here
GITLAB_GROUP=my-group
CLONE_PATH=./repositories
```

Then:

```bash
node cli/bin/gitlab-dump.js --update
```

### Batch processing with logging
For automated processes, save logs and reports:

```bash
mkdir -p logs/$(date +%Y-%m-%d)
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token> \
  --group production \
  --update \
  --clone-path ./production-repos \
  > logs/$(date +%Y-%m-%d)/sync.log 2>&1

echo "Sync completed at $(date)" >> logs/sync_history.txt
```

### Migration between GitLab instances
Clone from one GitLab instance and prepare for push to another:

```bash
# Step 1: Clone from source repositories
node cli/bin/gitlab-dump.js \
  --url https://old-gitlab.company.com \
  --token <old-token> \
  --group team \
  --clone-path ./migration-backup

# Step 2: For each repository, change remote and push
for repo in migration-backup/*/; do
  cd "$repo"
  git remote set-url origin https://new-gitlab.company.com/group/$(basename "$repo")
  git push --all origin
  git push --tags origin
  cd - > /dev/null
done
```

## Graphical User Interface (GUI)

`Gitlab Downloader` includes a cross-platform graphical user interface based on Electron and React for managing repository downloads and data migration. The GUI uses the shared `lib/` library directly via IPC, without any external server process.

### GUI Features
- Visual management of GitLab connection configuration
- Repository browsing and selection for cloning
- Real-time download progress tracking
- Repository migration between GitLab instances
- Author mapping during migration
- View logs and operation reports

### Running GUI

Run the application in development mode:
```bash
cd electron
npm install
npm run dev
```

Run the built application:
```bash
cd electron
npm start
```

### Building GUI

Create a portable application for your platform:
```bash
cd electron
npm run dist
```

Build for a specific platform:
```bash
npm run dist-mac      # for macOS
npm run dist-win      # for Windows
npm run dist-linux    # for Linux
```

Compiled applications will be in the `electron/dist_electron/` directory.

Build requirements:
- Node.js 16+
- npm

## Local Development

### Development Environment Setup

```bash
# Install all Node.js package dependencies
make node-install
```

### Running Components

Terminal 1 — GUI:
```bash
cd electron
npm run dev
```
GUI will open with hot reload on code changes.

Terminal 2 — CLI:
```bash
node cli/bin/gitlab-dump.js --help
node cli/bin/gitlab-dump.js --url https://gitlab.com --token <token> --group my-group
```

### Code Quality and Tests

Run linter:
```bash
make node-lint
```

Run tests:
```bash
make node-test
```

Run CI pipeline:
```bash
make node-ci
```

### Typical Developer Workflow

1. Create a new branch for your feature:
```bash
git checkout -b feature/my-feature
```

2. Install dependencies:
```bash
make node-install
```

3. Run components:
   - GUI: `cd electron && npm run dev`
   - CLI: `node cli/bin/gitlab-dump.js ...` with needed parameters

4. Make code changes and verify them:
```bash
make node-lint      # check syntax
make node-test      # run tests
```

5. Create a commit:
```bash
git add .
git commit -m "feat: description of changes"
```

6. Create Pull Request and wait for approval.

### Troubleshooting

**GUI fails to start**
- Ensure Node.js 16+ is installed: `node --version`
- Check npm dependencies are installed: `make node-install`
- Clear npm cache: `npm cache clean --force`
- Delete node_modules and reinstall: `make clean && make node-install`

**CLI commands not working**
- Verify dependencies are installed: `npm install --prefix cli`
- Use `node cli/bin/gitlab-dump.js --help` for help

**Git credentials issues during testing**
- Use real credentials only for local testing
- Use environment variables instead of explicit token passing for CI/CD

## Docker
```bash
docker build -t fetch-repositories .
docker run --rm \
  -e GITLAB_URL=https://gitlab.com \
  -e GITLAB_TOKEN=<token> \
  -e GITLAB_GROUP=<group> \
  -e CLONE_PATH=/app/repositories \
  -v $(pwd)/repositories:/app/repositories \
  fetch-repositories --dry-run
```

## Development
```bash
make node-lint
make node-test
make node-ci
```

## Binary Build

### Electron Application
```bash
make electron-build
```

Artifacts: `electron/dist_electron/` with platform-specific installers.

Build on each target OS separately (Linux on Linux, macOS on macOS, Windows on Windows). Use a CI matrix for automation.

## Requirements
- Node.js 16+
- Git
- GitLab token with `read_api` and `read_repository` scopes
