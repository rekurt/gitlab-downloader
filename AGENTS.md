# Repository Guidelines

## Project Overview
Async CLI tool for batch-cloning GitLab repositories by group or user.
Supports personal access tokens (PAT) and OAuth 2.0 device flow for authentication.

## Project Structure & Module Organization

### Entry Points
- `gitlab_downloader/app.py`: main async entry point (`run()` / `main()`); orchestrates config, auth, fetching, cloning, and reporting.
- `fetch_repositories.py`: legacy wrapper that re-exports package symbols and calls `app.run()`. Used by `pyinstaller` binary targets.
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

### Infrastructure
- `Makefile`: `make install`, `make run`, `make test`, `make lint`, `make typecheck`, `make ci`, `make binary`.
- `Dockerfile`: builds image using `pip install .` from `pyproject.toml`. Entry point: `gitlab-dump`.
- `.github/workflows/ci.yml`: runs ruff, mypy, and pytest on push/PR (Python 3.10).
- `.env.example`: sample env vars for local runs.
- `repositories/`: default clone target (created at runtime). Avoid committing its contents.

## Authentication
Two auth methods are supported (selected via `--auth-method` or interactive prompt):
1. **token** (default): uses `GITLAB_TOKEN` env var or `--token` argument.
2. **oauth**: OAuth 2.0 device authorization flow.
   - Requires `--oauth-client-id` (or `GITLAB_OAUTH_CLIENT_ID`).
   - Tokens are cached to `~/.gitlab-dump/oauth_cache.json` (configurable).
   - Expired tokens are refreshed automatically; if refresh fails, device flow restarts.

### Git Auth Modes
- `url_inject` (default): embeds token into clone URL as `oauth2:<token>@host`.
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
