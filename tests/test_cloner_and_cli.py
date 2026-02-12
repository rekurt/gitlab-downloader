from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from gitlab_downloader.cloner import clone_repository
from gitlab_downloader.config import parse_args
from gitlab_downloader.models import GitlabConfig


def make_config(tmp_path: Path, **overrides) -> GitlabConfig:
    data = {
        "url": "https://gitlab.com",
        "token": "token",
        "group": "my-group",
        "clone_path": str(tmp_path / "repositories"),
        "per_page": 2,
        "request_timeout": 3,
        "max_retries": 3,
        "clone_retries": 1,
        "max_concurrency": 2,
        "dry_run": False,
        "update_existing": False,
        "log_level": "INFO",
        "log_file": None,
        "interactive": False,
        "report_json": None,
    }
    data.update(overrides)
    return GitlabConfig(**data)


def test_parse_args_interactive(monkeypatch):
    answers = iter(
        [
            "https://gitlab.com",
            "token123",
            "team/group",
            "repositories",
            "3",
            "30",
            "100",
            "2",
            "1",
            "y",
            "n",
        ]
    )
    monkeypatch.setattr("builtins.input", lambda *_: next(answers))

    args = parse_args(["--interactive"])

    assert args.url == "https://gitlab.com"
    assert args.token == "token123"
    assert args.group == "team/group"
    assert args.concurrency == 3
    assert args.update is True
    assert args.dry_run is False


def test_parse_args_auto_interactive_without_cli_args(monkeypatch):
    monkeypatch.delenv("GITLAB_URL", raising=False)
    monkeypatch.delenv("GITLAB_TOKEN", raising=False)
    monkeypatch.delenv("GITLAB_GROUP", raising=False)
    answers = iter(
        [
            "https://gitlab.com",
            "token123",
            "team/group",
            "repositories",
            "3",
            "30",
            "100",
            "2",
            "1",
            "n",
            "n",
        ]
    )
    monkeypatch.setattr("builtins.input", lambda *_: next(answers))

    args = parse_args([])

    assert args.url == "https://gitlab.com"
    assert args.token == "token123"
    assert args.group == "team/group"


@pytest.mark.asyncio
async def test_clone_repository_updates_existing(monkeypatch, tmp_path: Path):
    config = make_config(tmp_path, update_existing=True)
    target_dir = Path(config.clone_path) / "repo"
    target_dir.mkdir(parents=True)

    async def fake_run(*args, **kwargs):
        assert args[:3] == ("git", "-C", str(target_dir))
        return 0, "", ""

    monkeypatch.setattr("gitlab_downloader.cloner.run_git_command", fake_run)

    result = await clone_repository(
        {"name": "repo", "group_path": "", "http_url_to_repo": "https://gitlab.com/a/repo.git"},
        config,
        asyncio.Semaphore(1),
        asyncio.Event(),
    )

    assert result.status == "updated"


@pytest.mark.asyncio
async def test_clone_repository_retries_and_fails(monkeypatch, tmp_path: Path):
    config = make_config(tmp_path, clone_retries=1)

    async def fake_run(*args, **kwargs):
        return 1, "", "boom"

    async def fake_sleep(*args, **kwargs):
        return None

    monkeypatch.setattr("gitlab_downloader.cloner.run_git_command", fake_run)
    monkeypatch.setattr("gitlab_downloader.cloner.asyncio.sleep", fake_sleep)

    result = await clone_repository(
        {"name": "repo", "group_path": "", "http_url_to_repo": "https://gitlab.com/a/repo.git"},
        config,
        asyncio.Semaphore(1),
        asyncio.Event(),
    )

    assert result.status == "failed"
    assert "Clone failed" in result.message
