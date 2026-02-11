# Gitlab Downloader

> **[Русская версия](README.MD)**

A tool for automatically cloning all repositories from a specified GitLab group, including subgroups. The local folder structure mirrors the group hierarchy in GitLab.

## Features

- Recursive traversal of groups and subgroups
- HTTPS cloning using a personal GitLab token
- Asynchronous cloning (up to 5 repositories in parallel)
- Retry with exponential backoff on API errors
- Local folder structure matching the GitLab hierarchy

## Quick start

### Requirements

- Python 3.10+
- Git
- Personal GitLab access token with `read_api` and `read_repository` scopes

### Installation

```bash
make venv        # create virtual environment and install dependencies
```

### Configuration

Create a `.env` file in the project root (see `.env.example`):

```env
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=your_token
GITLAB_GROUP=group_name_or_id
CLONE_PATH=./repositories          # optional, defaults to ./repositories
```

### Running

```bash
make run         # run locally (validates environment variables first)
```

or directly:

```bash
python fetch_repositories.py
```

## Docker

```bash
make build       # build the image
make docker_run  # build and run the container
```

The container mounts `./repositories` and the SSH agent; environment variables are passed from `.env`.

## Obtaining a GitLab token

1. Log in to your GitLab account.
2. Go to **Settings** → **Access Tokens** ([link for gitlab.com](https://gitlab.com/-/profile/personal_access_tokens)).
3. Enter a token name and select the scopes:
   - `read_api` — read access via API
   - `read_repository` — repository access
4. Click **Create personal access token** and save the token.

## Project structure

| File | Description |
|------|-------------|
| `fetch_repositories.py` | Main script (entry point) |
| `Makefile` | Commands for running, building, and Docker |
| `Dockerfile` | Docker image build |
| `requirements.txt` | Python dependencies (aiohttp, python-dotenv) |
| `.env.example` | Environment variables template |

## License

MIT
