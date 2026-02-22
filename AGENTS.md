# Repository Guidelines

## Project Overview
Async CLI tool for batch-cloning GitLab repositories by group or user.
Supports personal access tokens (PAT) and OAuth 2.0 device flow for authentication.

## Project Structure & Module Organization

### Entry Points
- `gitlab_downloader/app.py`: main async entry point (`run()` / `main()`); orchestrates config, auth, fetching, cloning, and reporting.
- `gitlab_downloader/api.py`: FastAPI application factory with `if __name__ == "__main__"` block. Runnable via `python -m gitlab_downloader.api --host <host> --port <port>` for Electron GUI backend startup.
- `pyproject.toml`: defines `gitlab-dump` console entry point via `gitlab_downloader.app:run`.

### Core Modules (`gitlab_downloader/`)
- `config.py`: CLI argument parsing (`argparse`), env-var loading, interactive prompt mode. Builds `GitlabConfig` dataclass.
- `auth.py`: Token resolution -- PAT pass-through or OAuth 2.0 device flow with token caching and refresh.
- `client.py`: HTTP helpers (`fetch_json`, `fetch_paginated`), rate-limit handling, project listing (`get_all_projects`, `get_user_projects`).
- `cloner.py`: Git clone/update logic with retries, semaphore-based concurrency, credential helper support.
- `reporting.py`: Summary logging (`print_summary`), JSON report (`write_json_report`), dry-run table (`print_dry_run`).
- `models.py`: Dataclasses `GitlabConfig` and `CloneResult`. `CloneResult.status` is typed as `Literal["success", "updated", "skipped", "failed"]`.
- `utils.py`: Path sanitization, URL building, group path extraction.
- `constants.py`: Default values and limits (concurrency, retries, timeouts, per_page).
- `logging_config.py`: Logging setup (stdout + optional file handler).

### Electron GUI Frontend (`electron/`)
- **Purpose**: Cross-platform desktop GUI for repository migration and management.
- **Framework**: Electron + React (Node.js frontend, communicates with Python REST API).
- **Entry point**: `electron/src/index.js` loads React root component.
- **Key components**:
  - `MigrationWizard.js`: Guides users through repository selection and configuration (author/committer mapping).
  - `RepoList.js`: Displays cloned repositories and their status.
  - `AuthorMapper.js`: UI for mapping original to new author information.
  - `ProgressIndicator.js`: Shows real-time migration progress.
- **API communication**: Uses `services/api.js` to call Python REST API endpoints (see "REST API Endpoints" below).
- **Styling**: CSS modules in `styles/` for component styling.
- **Build & Distribution**: Uses `electron-builder` for creating platform-specific binaries (.exe, .dmg, .AppImage).

### REST API Endpoints (Python FastAPI backend)
The Electron GUI communicates with the Python backend via these REST API endpoints:

- `GET /api/status`: Returns API status and application version.
- `GET /api/repos?clone_path=.`: Lists repositories in specified directory. Returns array of repository objects with name, path, and URL.
- `GET /api/config?repo_path=.`: Retrieves migration configuration from disk (JSON/YAML format).
- `POST /api/config`: Saves migration configuration to disk with author/committer mappings and target hosting details.
- `GET /api/author-mappings?config_path=.`: Loads saved author mappings from configuration file.
- `POST /api/author-mappings`: Saves author mappings to configuration file.
- `POST /api/migrate`: Starts a background migration task. Accepts repository path, author mappings, and committer mappings. Returns `migration_id`.
- `GET /api/migration-progress/{migration_id}`: Polls for migration progress. Returns status, progress percentage, current task, messages, and any errors.

**API Base URL**: `http://localhost:8000` (default) or `http://127.0.0.1:8000`.
**CORS**: Configured for localhost origins (http://localhost, http://127.0.0.1, ports 3000 and 8080) and `"null"` origin (for Electron production builds using `file://` protocol).
**API Token Security**: All API requests (except CORS preflight OPTIONS) must include a token in the `X-API-Token` header. The Electron main process generates a random token and passes it via the `GITLAB_DUMP_API_TOKEN` environment variable. If `GITLAB_DUMP_API_TOKEN` is not set, the API runs without authentication (development mode).

### Infrastructure
- `Makefile`: `make install`, `make run`, `make test`, `make lint`, `make typecheck`, `make ci`, `make binary`, `make electron-build`, `make coverage`, `make clean`, `make help`.
- `Dockerfile`: builds image using `pip install .` from `pyproject.toml`. Entry point: `gitlab-dump`.
- `.github/workflows/ci.yml`: runs ruff, mypy, and pytest on push/PR (Python 3.10).
- `.env.example`: sample env vars for local runs.
- `repositories/`: default clone target (created at runtime). Avoid committing its contents.
- `electron/`: Electron GUI frontend directory. Contains Node.js/React application for desktop GUI. See "Electron GUI Frontend" section above.
- `electron-builder.config.js`: Configuration file for electron-builder, defines build targets for different platforms (Windows, macOS, Linux).

## Authentication
Two auth methods are supported (selected via `--auth-method` or interactive prompt):
1. **token**: uses `GITLAB_TOKEN` env var or `--token` argument.
2. **oauth** (default): OAuth 2.0 device authorization flow.
   - Requires `--oauth-client-id` (or `GITLAB_OAUTH_CLIENT_ID`).
   - Tokens are cached to `~/.config/gitlab-dump/oauth_token.json` (configurable via `--oauth-cache-path`).
   - Expired tokens are refreshed automatically; if refresh fails, device flow restarts.
   - When no `--auth-method` is explicitly set and no OAuth client ID is available but a token exists, falls back to token auth automatically with a warning logged.

### Git Auth Modes
- `url` (default): embeds token into clone URL as `oauth2:<token>@host`.
- `credential_helper`: stores credentials via `git credential approve` for the host.

## Build, Test, and Development Commands
- Install: `make install` (creates venv, installs package with dev deps via `pip install -e .[dev]`).
- Run: `make run` (requires `.env` or env vars: `GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_GROUP`).
- Interactive mode: `make interactive` or `gitlab-dump --interactive`.
- Docker build: `make build`.
- Docker run: `make docker_run` (mounts `repositories/` and injects env vars).
- Binary: `make binary` or `make binary_onefile` (pyinstaller).

## Testing
- Framework: `pytest` with `pytest-asyncio` (asyncio_mode = "auto").
- HTTP mocking: `aioresponses`.
- Run tests: `make test` or `pytest`.
- Run all checks: `make ci` (ruff + mypy + pytest).
- Test files: `tests/test_cloner_and_cli.py`, `tests/test_client.py`, `tests/test_auth.py`, `tests/test_reporting.py`.
- When adding new modules, create a corresponding `tests/test_<module>.py` file.
- Test both happy-path and failure responses (403/404, retries, edge cases).

## Coding Style & Naming Conventions
- Python 3.10+. PEP 8, 4-space indent, snake_case.
- Linter: `ruff` (rules: E, F, I, UP, B; line-length 100).
- Type checker: `mypy` (strict=false).
- Async patterns throughout; network and filesystem ops isolated in dedicated modules.
- English log/output text.

## Commit & Pull Request Guidelines
- Commit messages: short imperative line (e.g., `feat: add retry for project fetch`).
- PRs should describe intent, steps to verify, and note env var or config changes.
- CI must pass (ruff, mypy, pytest) before merge.

## Security & Configuration Tips
- Never commit `.env` or tokens. Use environment variables or `.env` (git-ignored).
- Tokens need `read_api` and `read_repository` scopes; rotate regularly.
- Scrub URLs/tokens from shared logs; paths under `repositories/` may contain private group names.
- API path validation: All API endpoints that accept file paths use `_validate_path()` in `api_routes.py` which rejects `..` components, resolves the path, and verifies it falls within `_allowed_base_dirs` (defaults to user home directory) to prevent directory traversal attacks.
