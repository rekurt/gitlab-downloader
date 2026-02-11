# CLAUDE.md

## Project overview

gitlab-downloader is a Python 3.10+ async CLI tool that recursively clones all repositories from a GitLab group (including subgroups), preserving the group hierarchy as a local folder structure.

Single-file project: `fetch_repositories.py` (~270 lines).

## Setup and commands

Requires a `.env` file with `GITLAB_URL`, `GITLAB_TOKEN`, and `GITLAB_GROUP` (see `.env.example`). Optional: `CLONE_PATH` (defaults to `./repositories`).

```
make venv && make install   # Create venv and install dependencies
make run                    # Run locally (validates env vars first)
make build                  # Build Docker image
make docker_run             # Run in Docker container
```

## Dependencies

Listed in `requirements.txt`: aiohttp (3.8.5), python-dotenv (1.0.0).

## Architecture

`fetch_repositories.py` contains everything:

- **GitlabConfig** dataclass — central configuration (per_page, timeout, retries, concurrency)
- **Env/path helpers** — `require_env()`, `sanitize_path_component()`, `extract_group_path()`
- **API layer** — `fetch_json()` with retry/backoff, `fetch_paginated()`, `fetch_group_metadata()`, `get_all_projects()` (BFS over groups)
- **Clone logic** — `clone_repository()` (semaphore-gated), `clone_all_repositories()`
- **`main()`** — async entry point orchestrating config → fetch → clone

## Code conventions

- Type hints throughout (dataclasses, typing module)
- Async/await with `asyncio.Semaphore` for concurrency control (default max 5)
- Logging via print with `[info]`, `[warn]`, `[error]` prefixes
- Exponential backoff on retries (capped at 10s), handles 429 and 5xx
- Path sanitization against directory traversal (`..`, `\`)
- Git credentials passed via temp file + `GIT_ASKPASS` (cleaned up in finally block)

## Testing and linting

No test suite or linter is configured.
