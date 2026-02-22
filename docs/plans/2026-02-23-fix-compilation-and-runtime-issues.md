# Fix compilation and runtime issues in gitlab-dump

## Overview
Fix critical runtime issues preventing the Electron app from starting, clean up legacy code, and address moderate issues in the API layer.

## Context
- Files involved: `gitlab_downloader/api.py`, `electron/main.js`, `fetch_repositories.py`, `tests/test_fetch_repositories.py`, `Dockerfile`, `gitlab_downloader/api_routes.py`, `gitlab_downloader/config.py`, `gitlab_downloader/auth.py`
- Related patterns: async FastAPI server, CLI entry points with argparse
- Dependencies: none new

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Fix Electron API server startup (CRITICAL)

The Electron app runs `python -m gitlab_downloader.api --host 127.0.0.1 --port 8000` but `api.py` has no `if __name__` block and no CLI argument parsing. The command silently exits with code 0, so the Electron app has no backend.

**Files:**
- Modify: `gitlab_downloader/api.py`

- [x] Add `if __name__ == "__main__"` block to `api.py` with argparse for `--host` and `--port`
- [x] Call `asyncio.run(run_api_server_async(...))` from the main block
- [x] Test manually: `venv/bin/python -m gitlab_downloader.api --host 127.0.0.1 --port 19999` should start uvicorn
- [x] Add/update tests verifying the module can be invoked
- [x] Run project test suite - must pass before task 2

### Task 2: Remove legacy fetch_repositories.py wrapper

`fetch_repositories.py` in the project root is a legacy wrapper that just re-exports from `gitlab_downloader`. Tests import from it instead of the real package. The Dockerfile copies it unnecessarily.

**Files:**
- Delete: `fetch_repositories.py`
- Modify: `tests/test_fetch_repositories.py`
- Modify: `Dockerfile`

- [x] Update `tests/test_fetch_repositories.py` to import from `gitlab_downloader` package modules directly instead of `fetch_repositories`
- [x] Remove `COPY fetch_repositories.py .` from `Dockerfile`
- [x] Delete `fetch_repositories.py`
- [x] Run project test suite - must pass before task 3

### Task 3: Fix path validation in API routes

`_validate_path()` checks for `..` in original path AFTER calling `resolve()` on a separate Path object. The check is correct (it checks original input), but it lacks boundary validation - it doesn't verify the resolved path is within an allowed base directory.

**Files:**
- Modify: `gitlab_downloader/api_routes.py`

- [x] Add base directory boundary check to `_validate_path` - ensure resolved path starts with an expected prefix (e.g., the clone_path or home directory)
- [x] Update tests for path validation
- [x] Run project test suite - must pass before task 4

### Task 4: Add auth method fallback warning

When user configures OAuth but provides a token without OAuth client ID, the app silently falls back to token auth. Users should be informed.

**Files:**
- Modify: `gitlab_downloader/config.py`

- [x] Add `logger.warning()` when auth method falls back from OAuth to token
- [x] Update or add test verifying warning is logged
- [x] Run project test suite - must pass before task 5

### Task 5: Improve OAuth cache error logging

`auth.py:_read_cache` logs corrupted cache at DEBUG level. Users won't know their cache is broken and will have to re-authenticate every time.

**Files:**
- Modify: `gitlab_downloader/auth.py`

- [x] Change `logger.debug` to `logger.warning` for JSON decode errors in `_read_cache`
- [x] Update or add test verifying warning is logged on corrupted cache
- [x] Run project test suite - must pass before task 6

### Task 6: Verify acceptance criteria

- [x] Manual test: run `venv/bin/python -m gitlab_downloader.api --host 127.0.0.1 --port 19999` and verify server starts
- [x] Manual test: run `venv/bin/gitlab-dump --help` and verify CLI works
- [x] Run full test suite (`make test`)
- [x] Run linter (`make lint`)
- [x] Run type checker (`make typecheck`)
- [x] Verify test coverage meets 80%+

### Task 7: Update documentation

- [ ] Update CLAUDE.md if internal patterns changed
- [ ] Move this plan to `docs/plans/completed/`
