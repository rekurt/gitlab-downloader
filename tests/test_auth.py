from __future__ import annotations

import json
from pathlib import Path

import pytest

from gitlab_downloader.auth import resolve_access_token
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
        "auth_method": "token",
        "git_auth_mode": "url",
        "oauth_client_id": None,
        "oauth_client_secret": None,
        "oauth_scope": "read_api read_repository",
        "oauth_cache_path": str(tmp_path / "oauth.json"),
    }
    data.update(overrides)
    return GitlabConfig(**data)


@pytest.mark.asyncio
async def test_resolve_access_token_token_mode(tmp_path: Path):
    cfg = make_config(tmp_path, auth_method="token", token="abc")
    token = await resolve_access_token(cfg)
    assert token == "abc"


@pytest.mark.asyncio
async def test_resolve_access_token_oauth_uses_cached_token(tmp_path: Path):
    cache = tmp_path / "oauth.json"
    cache.write_text(
        json.dumps(
            {
                "instance_url": "https://gitlab.com",
                "client_id": "cid",
                "scope": "read_api read_repository",
                "access_token": "cached-token",
                "refresh_token": "refresh",
                "token_type": "Bearer",
                "expires_at": 9999999999,
            }
        ),
        encoding="utf-8",
    )
    cfg = make_config(
        tmp_path,
        auth_method="oauth",
        token=None,
        oauth_client_id="cid",
        oauth_cache_path=str(cache),
    )

    token = await resolve_access_token(cfg)
    assert token == "cached-token"
