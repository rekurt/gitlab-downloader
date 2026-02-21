# Gitlab Downloader

Language: **English (additional)** | [Русский (основной)](README.MD)

`Gitlab Downloader` is an async utility for fetching and cloning all repositories from a GitLab group and its subgroups while preserving directory hierarchy.

## Features
- Recursive group/subgroup traversal.
- Async cloning with concurrency limits.
- Retry for API requests and `git clone`.
- Final summary (`success`, `updated`, `skipped`, `failed`).
- `--dry-run` mode to preview operations.
- `--update` mode to run `git pull --ff-only` for existing clones.

## Installation
```bash
python3 -m venv venv
venv/bin/pip install -e .[dev]
```

or:

```bash
make install
```

## Usage

You can use CLI flags or environment variables (`GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_GROUP`, `CLONE_PATH`).
`GITLAB_GROUP` is optional: if omitted, the tool fetches current user's membership projects.

```bash
gitlab-dump --help
gitlab-dump --version
gitlab-dump --url https://gitlab.com --token <token> --group <group>
gitlab-dump --url https://gitlab.com --token <token>
gitlab-dump --dry-run --url https://gitlab.com --token <token> --group <group>
gitlab-dump --update --url https://gitlab.com --token <token> --group <group>
```

### OAuth Device Flow
```bash
gitlab-dump \
  --url https://gitlab.com \
  --auth-method oauth \
  --oauth-client-id <client_id> \
  --git-auth-mode credential_helper
```
The CLI prints a browser URL and code, then stores access/refresh tokens in cache (`~/.config/gitlab-dump/oauth_token.json` by default).

### Git Credential Helper
For `clone/pull` without token in URL:
```bash
gitlab-dump \
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
gitlab-dump \
  --url https://gitlab.com \
  --token <token> \
  --group my-group \
  --dry-run
```

The output will show all repositories to be cloned, including their size and last commit info.

### Update existing repositories
If repositories are already cloned, use `--update` to fetch the latest changes:

```bash
gitlab-dump \
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
gitlab-dump \
  --url https://gitlab.internal.company.com \
  --token <private-token> \
  --group engineering \
  --clone-path ./internal-repos
```

### Export current user's projects
If you don't need a group, export only projects you have access to:

```bash
gitlab-dump \
  --url https://gitlab.com \
  --token <token> \
  --clone-path ./my-projects
```

### OAuth with Git credential helper
Modern approach without explicit token in arguments:

```bash
# First run — prompts for browser login
gitlab-dump \
  --url https://gitlab.com \
  --auth-method oauth \
  --oauth-client-id <client_id> \
  --git-auth-mode credential_helper \
  --group frontend-team

# Subsequent runs use cached token
gitlab-dump \
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

gitlab-dump --dry-run
gitlab-dump --update
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

Then in your script:

```bash
#!/bin/bash
source .env
gitlab-dump --update
```

### Batch processing with logging
For automated processes, save logs and reports:

```bash
mkdir -p logs/$(date +%Y-%m-%d)
gitlab-dump \
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
gitlab-dump \
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

`Gitlab Downloader` includes a cross-platform graphical user interface based on Electron and React for managing repository downloads and data migration.

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

Compiled applications will be in the `electron/dist/` directory.

Build requirements:
- Node.js 16+
- npm or yarn
- Python 3.10+ (for embedded Python backend)

## Local Development

### Development Environment Setup

To develop the complete project with CLI, REST API, and Electron GUI:

1. Install Python dependencies:
```bash
make install
```

2. Install Electron/Node.js dependencies:
```bash
cd electron
npm install
cd ..
```

### Running All Components

#### Option 1: In separate terminals (recommended)

Terminal 1 — Python REST API:
```bash
# Activate virtual environment (if needed)
source venv/bin/activate

# Run REST API on local server
python -m gitlab_downloader.api
```
API will be available at: `http://localhost:5000`

Terminal 2 — Electron GUI (development mode):
```bash
cd electron
npm run dev
```
GUI will open with hot reload on code changes.

Terminal 3 — Using CLI:
```bash
# In main project directory
gitlab-dump --help
gitlab-dump --url https://gitlab.com --token <token> --group my-group
```

#### Option 2: Running API in background

```bash
# Start API in background
python -m gitlab_downloader.api &

# Then in same terminal run GUI
cd electron
npm run dev

# Or use CLI
gitlab-dump --url https://gitlab.com --token <token> --group my-group
```

### Code Quality and Tests

Run linter:
```bash
make lint
```

Format code:
```bash
make format
```

Run tests:
```bash
make test
```

Check test coverage:
```bash
make coverage
```

### Typical Developer Workflow

1. Create a new branch for your feature:
```bash
git checkout -b feature/my-feature
```

2. Install dependencies:
```bash
make install
cd electron && npm install && cd ..
```

3. Run components (in separate terminals):
   - REST API: `python -m gitlab_downloader.api`
   - GUI: `cd electron && npm run dev`
   - CLI: `gitlab-dump ...` with needed parameters

4. Make code changes and verify them:
```bash
make lint      # check syntax
make format    # format code
make test      # run tests
```

5. Create a commit:
```bash
git add .
git commit -m "feat: description of changes"
```

6. Create Pull Request and wait for approval.

### Troubleshooting

**API fails to start**
- Ensure Python 3.10+ is installed: `python --version`
- Check that virtual environment is activated
- Verify dependencies are installed: `make install`

**GUI fails to start**
- Ensure Node.js 16+ is installed: `node --version`
- Check npm dependencies are installed: `cd electron && npm install`
- Clear npm cache: `npm cache clean --force`
- Delete node_modules and reinstall: `rm -rf node_modules && npm install`

**CLI commands not working**
- Ensure package is installed in development mode: `pip install -e .[dev]`
- Check that virtual environment is activated
- Use `python -m gitlab_downloader.cli --help` for help

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
make lint
make format
make test
```

## Binary Build
Fast local build (recommended, `onedir`):
```bash
make binary
```

Single-file build (slower startup, `onefile`):
```bash
make binary_onefile
```

Artifacts:
- `onedir` (fast): `dist/gitlab-dump/`
- `onefile` (portable):
  - macOS/Linux: `dist/gitlab-dump`
  - Windows: `dist/gitlab-dump.exe`

Clean build artifacts:
```bash
make binary_clean
```

Important: `onefile` starts slower because it unpacks on launch. For frequent runs use `make binary`. Build on each target OS separately (Linux on Linux, macOS on macOS, Windows on Windows). Use a CI matrix for automation.

## Requirements
- Python 3.10+
- Git
- GitLab token with `read_api` and `read_repository` scopes

For using the GUI (graphical interface):
- Node.js 16+
- npm or yarn
