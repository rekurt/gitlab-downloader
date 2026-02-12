from __future__ import annotations

import argparse
import asyncio
import json

import aiohttp
import pytest
from aioresponses import aioresponses

import fetch_repositories as fr


def make_config(**overrides):
    data = {
        "url": "https://gitlab.com",
        "token": "token",
        "group": "my-group",
        "clone_path": "repositories",
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
        "oauth_cache_path": ".tmp-oauth-cache.json",
    }
    data.update(overrides)
    return fr.GitlabConfig(**data)


@pytest.mark.parametrize(
    ("value", "prefix", "expected"),
    [
        ("group/sub/repo", "group", "sub/repo"),
        ("/group/sub/repo/", "/group/", "sub/repo"),
        ("group/sub/repo", "other", "group/sub/repo"),
        ("repo", "", "repo"),
    ],
)
def test_trim_prefix(value, prefix, expected):
    assert fr.trim_prefix(value, prefix) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("../foo", "foo"),
        ("..\\foo\\bar", "foo/bar"),
        ("a\x00b/c", "ab/c"),
        ("a/./b/../c", "a/b/c"),
    ],
)
def test_sanitize_path_component(value, expected):
    assert fr.sanitize_path_component(value) == expected


def test_extract_group_path():
    assert fr.extract_group_path("root/main", "root/main/sub/repo") == "sub"
    assert fr.extract_group_path("root/main", "root/main/repo") == ""


def test_parse_args_env_fallback(monkeypatch):
    monkeypatch.setenv("GITLAB_URL", "https://gitlab.com")
    monkeypatch.setenv("GITLAB_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setenv("GITLAB_GROUP", "env-group")
    args = fr.parse_args([])

    assert args.url == "https://gitlab.com"
    assert args.auth_method == "oauth"
    assert args.oauth_client_id == "client-id"
    assert args.group == "env-group"


def test_parse_args_cli_overrides_env(monkeypatch):
    monkeypatch.setenv("GITLAB_URL", "https://gitlab.com")
    monkeypatch.setenv("GITLAB_TOKEN", "env-token")
    monkeypatch.setenv("GITLAB_GROUP", "env-group")

    args = fr.parse_args(
        ["--token", "cli-token", "--group", "cli-group", "--url", "https://example.com"]
    )
    assert args.token == "cli-token"
    assert args.group == "cli-group"
    assert args.url == "https://example.com"


def test_parse_args_group_optional(monkeypatch):
    monkeypatch.setenv("GITLAB_URL", "https://gitlab.com")
    monkeypatch.setenv("GITLAB_TOKEN", "env-token")
    monkeypatch.delenv("GITLAB_GROUP", raising=False)

    args = fr.parse_args(["--url", "https://gitlab.com", "--token", "token"])
    assert args.group is None


def test_parse_args_missing_required(monkeypatch):
    monkeypatch.delenv("GITLAB_URL", raising=False)
    monkeypatch.delenv("GITLAB_TOKEN", raising=False)
    monkeypatch.delenv("GITLAB_GROUP", raising=False)
    with pytest.raises(SystemExit):
        fr.parse_args(["--url", "https://gitlab.com"])


def test_parse_args_oauth_requires_client_id(monkeypatch):
    monkeypatch.setenv("GITLAB_URL", "https://gitlab.com")
    monkeypatch.delenv("GITLAB_OAUTH_CLIENT_ID", raising=False)
    with pytest.raises(SystemExit):
        fr.parse_args(["--auth-method", "oauth"])


def test_parse_args_oauth_client_id_from_cache(tmp_path):
    cache_path = tmp_path / "oauth.json"
    cache_path.write_text(
        json.dumps(
            {
                "instance_url": "https://gitlab.com",
                "client_id": "cached-client-id",
            }
        ),
        encoding="utf-8",
    )
    args = fr.parse_args(
        [
            "--url",
            "https://gitlab.com",
            "--auth-method",
            "oauth",
            "--oauth-cache-path",
            str(cache_path),
        ]
    )
    assert args.oauth_client_id == "cached-client-id"


@pytest.mark.parametrize(
    ("argv", "error_part"),
    [
        (["--url", "not-url", "--token", "t", "--group", "g"], "Invalid --url"),
        (
            [
                "--url",
                "https://gitlab.com",
                "--token",
                "t",
                "--group",
                "g",
                "--concurrency",
                "0",
            ],
            "--concurrency",
        ),
        (
            [
                "--url",
                "https://gitlab.com",
                "--token",
                "t",
                "--group",
                "g",
                "--timeout",
                "0",
            ],
            "--timeout",
        ),
    ],
)
def test_parse_args_validation(argv, error_part):
    with pytest.raises(SystemExit) as exc:
        fr.parse_args(argv)
    assert error_part in str(exc.value) or exc.value.code == 2


def test_config_from_args():
    args = argparse.Namespace(
        url="https://gitlab.com",
        token="t",
        group="g",
        clone_path="repos",
        per_page=50,
        timeout=10,
        api_retries=2,
        clone_retries=1,
        concurrency=4,
        dry_run=True,
        update=True,
        log_level="DEBUG",
        log_file="app.log",
        interactive=False,
        report_json=None,
        auth_method="token",
        git_auth_mode="url",
        oauth_client_id=None,
        oauth_client_secret=None,
        oauth_scope="read_api read_repository",
        oauth_cache_path=".tmp-oauth-cache.json",
    )
    cfg = fr.config_from_args(args)
    assert cfg.url == "https://gitlab.com"
    assert cfg.max_concurrency == 4
    assert cfg.update_existing is True


def test_print_summary(caplog):
    caplog.set_level("INFO")
    results = [
        fr.CloneResult("a", "success", "ok"),
        fr.CloneResult("b", "skipped", "skip"),
        fr.CloneResult("c", "failed", "boom"),
        fr.CloneResult("d", "updated", "done"),
    ]
    has_failed = fr.print_summary(results)

    assert has_failed is True
    assert "Summary:" in caplog.text
    assert "Failed repositories" in caplog.text


@pytest.mark.asyncio
async def test_fetch_json_success():
    config = make_config()
    url = "https://gitlab.com/api/v4/groups/test"

    with aioresponses() as mocked:
        mocked.get(url, payload={"id": 1}, status=200)
        async with aiohttp.ClientSession() as session:
            data = await fr.fetch_json(session, url, {}, "group metadata", config)

    assert data == {"id": 1}


@pytest.mark.asyncio
async def test_fetch_json_retries_on_429_then_success():
    config = make_config(max_retries=3)
    url = "https://gitlab.com/api/v4/groups/test"

    with aioresponses() as mocked:
        mocked.get(url, status=429, body="rate limit")
        mocked.get(url, payload={"ok": True}, status=200)

        async with aiohttp.ClientSession() as session:
            data = await fr.fetch_json(session, url, {}, "group metadata", config)

    assert data == {"ok": True}


@pytest.mark.asyncio
async def test_fetch_json_respects_retry_after(monkeypatch):
    config = make_config(max_retries=2)
    url = "https://gitlab.com/api/v4/groups/test"
    slept = []

    async def fake_sleep(delay):
        slept.append(delay)

    monkeypatch.setattr("gitlab_downloader.client.asyncio.sleep", fake_sleep)

    with aioresponses() as mocked:
        mocked.get(url, status=429, headers={"Retry-After": "0"})
        mocked.get(url, payload={"ok": True}, status=200)

        async with aiohttp.ClientSession() as session:
            data = await fr.fetch_json(session, url, {}, "group metadata", config)

    assert data == {"ok": True}
    assert slept


@pytest.mark.asyncio
async def test_fetch_json_retries_on_500_then_success():
    config = make_config(max_retries=3)
    url = "https://gitlab.com/api/v4/groups/test"

    with aioresponses() as mocked:
        mocked.get(url, status=500, body="server error")
        mocked.get(url, payload={"ok": True}, status=200)

        async with aiohttp.ClientSession() as session:
            data = await fr.fetch_json(session, url, {}, "group metadata", config)

    assert data == {"ok": True}


@pytest.mark.asyncio
async def test_fetch_json_timeout_returns_none():
    config = make_config(max_retries=1)
    url = "https://gitlab.com/api/v4/groups/test"

    with aioresponses() as mocked:
        mocked.get(url, exception=asyncio.TimeoutError())

        async with aiohttp.ClientSession() as session:
            data = await fr.fetch_json(session, url, {}, "group metadata", config)

    assert data is None


@pytest.mark.asyncio
async def test_fetch_paginated_multiple_pages():
    config = make_config(per_page=2)
    url = "https://gitlab.com/api/v4/groups/1/projects"

    with aioresponses() as mocked:
        mocked.get(f"{url}?per_page=2&page=1", payload=[{"id": 1}, {"id": 2}], status=200)
        mocked.get(f"{url}?per_page=2&page=2", payload=[{"id": 3}], status=200)

        async with aiohttp.ClientSession() as session:
            data = await fr.fetch_paginated(session, url, {}, "projects", config)

    assert [item["id"] for item in data] == [1, 2, 3]


@pytest.mark.asyncio
async def test_fetch_paginated_empty():
    config = make_config(per_page=2)
    url = "https://gitlab.com/api/v4/groups/1/projects"

    with aioresponses() as mocked:
        mocked.get(f"{url}?per_page=2&page=1", payload=[], status=200)
        async with aiohttp.ClientSession() as session:
            data = await fr.fetch_paginated(session, url, {}, "projects", config)

    assert data == []


def test_build_authenticated_clone_url():
    url = "https://gitlab.com/group/repo.git"
    result = fr.build_authenticated_clone_url(url, "my:token/with?symbols")
    assert result.startswith("https://oauth2:")
    assert "@gitlab.com/group/repo.git" in result


def test_maybe_rate_limit_delay():
    headers = {"RateLimit-Remaining": "5", "RateLimit-Reset": str(9999999999)}
    assert fr.maybe_rate_limit_delay(headers) > 0
