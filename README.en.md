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
venv/bin/pip install -r requirements.txt
venv/bin/pip install -e .[dev]
```

or:

```bash
make install
```

## Usage

You can use CLI flags or environment variables (`GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_GROUP`, `CLONE_PATH`).

```bash
python fetch_repositories.py --help
python fetch_repositories.py --url https://gitlab.com --token <token> --group <group>
python fetch_repositories.py --dry-run --url https://gitlab.com --token <token> --group <group>
python fetch_repositories.py --update --url https://gitlab.com --token <token> --group <group>
```

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

## Requirements
- Python 3.10+
- Git
- GitLab token with `read_api` and `read_repository` scopes
