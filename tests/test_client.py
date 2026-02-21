from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiohttp
import pytest
from aioresponses import aioresponses

from gitlab_downloader.client import (
    fetch_json,
    fetch_paginated,
    get_all_projects,
    get_user_projects,
    maybe_rate_limit_delay,
)
from gitlab_downloader.models import GitlabConfig


def make_config(tmp_path: Path, **overrides) -> GitlabConfig:
    data = {
        "url": "https://gitlab.example.com",
        "token": "test-token",
        "group": "my-group",
        "clone_path": str(tmp_path / "repositories"),
        "per_page": 2,
        "request_timeout": 5,
        "max_retries": 3,
        "clone_retries": 1,
        "max_concurrency": 2,
        "dry_run": False,
        "update_existing": False,
        "log_level": "INFO",
        "log_file": None,
        "interactive": False,
        "interactive_menu": False,
        "report_json": None,
        "auth_method": "token",
        "git_auth_mode": "url",
        "oauth_client_id": None,
        "oauth_client_secret": None,
        "oauth_scope": "read_api read_repository",
        "oauth_cache_path": ".tmp-oauth-cache.json",
        "api_server": False,
        "api_host": "127.0.0.1",
        "api_port": 8000,
    }
    data.update(overrides)
    return GitlabConfig(**data)


API_URL = "https://gitlab.example.com/api/v4"


# --- maybe_rate_limit_delay ---


class TestMaybeRateLimitDelay:
    def test_no_headers_returns_zero(self):
        headers: dict[str, str] = {}
        assert maybe_rate_limit_delay(headers) == 0.0

    def test_high_remaining_returns_zero(self):
        headers = {"RateLimit-Remaining": "50", "RateLimit-Reset": str(int(time.time()) + 60)}
        assert maybe_rate_limit_delay(headers) == 0.0

    def test_low_remaining_returns_delay(self):
        reset_time = int(time.time()) + 15
        headers = {"RateLimit-Remaining": "5", "RateLimit-Reset": str(reset_time)}
        delay = maybe_rate_limit_delay(headers)
        assert 0 < delay <= 30

    def test_remaining_at_boundary_returns_zero(self):
        headers = {"RateLimit-Remaining": "10", "RateLimit-Reset": str(int(time.time()) + 10)}
        assert maybe_rate_limit_delay(headers) == 0.0

    def test_invalid_values_return_zero(self):
        headers = {"RateLimit-Remaining": "abc", "RateLimit-Reset": "xyz"}
        assert maybe_rate_limit_delay(headers) == 0.0

    def test_missing_one_header_returns_zero(self):
        headers = {"RateLimit-Remaining": "5"}
        assert maybe_rate_limit_delay(headers) == 0.0

    def test_delay_capped_at_30(self):
        reset_time = int(time.time()) + 600
        headers = {"RateLimit-Remaining": "1", "RateLimit-Reset": str(reset_time)}
        delay = maybe_rate_limit_delay(headers)
        assert delay == 30.0


# --- fetch_json ---


class TestFetchJson:
    @pytest.fixture
    def config(self, tmp_path):
        return make_config(tmp_path)

    async def test_success_returns_json(self, config):
        url = f"{API_URL}/projects"
        payload = [{"id": 1, "name": "project1"}]

        with aioresponses() as mocked:
            mocked.get(url, payload=payload)
            async with aiohttp.ClientSession() as session:
                result = await fetch_json(session, url, {}, "test", config)

        assert result == payload

    async def test_success_returns_dict(self, config):
        url = f"{API_URL}/groups/123"
        payload = {"id": 123, "name": "group"}

        with aioresponses() as mocked:
            mocked.get(url, payload=payload)
            async with aiohttp.ClientSession() as session:
                result = await fetch_json(session, url, {}, "test", config)

        assert result == payload

    @patch("gitlab_downloader.client.asyncio.sleep", new_callable=AsyncMock)
    async def test_retry_on_429(self, mock_sleep, config):
        url = f"{API_URL}/projects"
        payload = [{"id": 1}]

        with aioresponses() as mocked:
            mocked.get(url, status=429, body="rate limited")
            mocked.get(url, status=429, body="rate limited")
            mocked.get(url, payload=payload)
            async with aiohttp.ClientSession() as session:
                result = await fetch_json(session, url, {}, "test", config)

        assert result == payload
        assert mock_sleep.call_count >= 2

    @patch("gitlab_downloader.client.asyncio.sleep", new_callable=AsyncMock)
    async def test_retry_on_500(self, mock_sleep, config):
        url = f"{API_URL}/projects"
        payload = [{"id": 1}]

        with aioresponses() as mocked:
            mocked.get(url, status=500, body="server error")
            mocked.get(url, payload=payload)
            async with aiohttp.ClientSession() as session:
                result = await fetch_json(session, url, {}, "test", config)

        assert result == payload
        assert mock_sleep.call_count >= 1

    async def test_returns_none_on_4xx(self, config):
        url = f"{API_URL}/projects"

        with aioresponses() as mocked:
            mocked.get(url, status=403, body="forbidden")
            async with aiohttp.ClientSession() as session:
                result = await fetch_json(session, url, {}, "test", config)

        assert result is None

    async def test_returns_none_on_404(self, config):
        url = f"{API_URL}/groups/999"

        with aioresponses() as mocked:
            mocked.get(url, status=404, body="not found")
            async with aiohttp.ClientSession() as session:
                result = await fetch_json(session, url, {}, "test", config)

        assert result is None

    @patch("gitlab_downloader.client.asyncio.sleep", new_callable=AsyncMock)
    async def test_gives_up_after_max_retries(self, mock_sleep, config):
        url = f"{API_URL}/projects"

        with aioresponses() as mocked:
            for _ in range(config.max_retries):
                mocked.get(url, status=500, body="server error")
            async with aiohttp.ClientSession() as session:
                result = await fetch_json(session, url, {}, "test", config)

        assert result is None

    @patch("gitlab_downloader.client.asyncio.sleep", new_callable=AsyncMock)
    async def test_retry_after_header_respected(self, mock_sleep, config):
        url = f"{API_URL}/projects"
        payload = [{"id": 1}]

        with aioresponses() as mocked:
            mocked.get(url, status=429, body="rate limited", headers={"Retry-After": "2"})
            mocked.get(url, payload=payload)
            async with aiohttp.ClientSession() as session:
                result = await fetch_json(session, url, {}, "test", config)

        assert result == payload
        first_sleep_arg = mock_sleep.call_args_list[0][0][0]
        assert first_sleep_arg == 2.0


# --- fetch_paginated ---


class TestFetchPaginated:
    @pytest.fixture
    def config(self, tmp_path):
        return make_config(tmp_path, per_page=2)

    async def test_multi_page(self, config):
        url = f"{API_URL}/groups/1/projects"
        pages = [[{"id": 1}, {"id": 2}], [{"id": 3}]]
        call_count = 0

        async def fake_fetch_json(_session, _url, _params, _desc, _cfg):
            nonlocal call_count
            idx = call_count
            call_count += 1
            return pages[idx] if idx < len(pages) else None

        with patch("gitlab_downloader.client.fetch_json", side_effect=fake_fetch_json):
            async with aiohttp.ClientSession() as session:
                result = await fetch_paginated(session, url, {}, "test", config)

        assert len(result) == 3
        assert result == pages[0] + pages[1]

    async def test_empty_result(self, config):
        async def fake_fetch_json(_session, _url, _params, _desc, _cfg):
            return []

        with patch("gitlab_downloader.client.fetch_json", side_effect=fake_fetch_json):
            async with aiohttp.ClientSession() as session:
                result = await fetch_paginated(
                    session, f"{API_URL}/groups/1/projects", {}, "test", config
                )

        assert result == []

    async def test_single_full_page_then_empty(self, config):
        pages = [[{"id": 1}, {"id": 2}], []]
        call_count = 0

        async def fake_fetch_json(_session, _url, _params, _desc, _cfg):
            nonlocal call_count
            idx = call_count
            call_count += 1
            return pages[idx] if idx < len(pages) else None

        with patch("gitlab_downloader.client.fetch_json", side_effect=fake_fetch_json):
            async with aiohttp.ClientSession() as session:
                result = await fetch_paginated(
                    session, f"{API_URL}/groups/1/projects", {}, "test", config
                )

        assert result == pages[0]

    async def test_stops_on_none(self, config):
        pages = [[{"id": 1}, {"id": 2}], None]
        call_count = 0

        async def fake_fetch_json(_session, _url, _params, _desc, _cfg):
            nonlocal call_count
            idx = call_count
            call_count += 1
            return pages[idx] if idx < len(pages) else None

        with patch("gitlab_downloader.client.fetch_json", side_effect=fake_fetch_json):
            async with aiohttp.ClientSession() as session:
                result = await fetch_paginated(
                    session, f"{API_URL}/groups/1/projects", {}, "test", config
                )

        assert result == pages[0]

    async def test_passes_correct_params(self, config):
        captured_params: list[dict] = []

        async def fake_fetch_json(_session, _url, params, _desc, _cfg):
            captured_params.append(params)
            return []

        with patch("gitlab_downloader.client.fetch_json", side_effect=fake_fetch_json):
            async with aiohttp.ClientSession() as session:
                await fetch_paginated(
                    session, f"{API_URL}/projects", {"foo": "bar"}, "test", config
                )

        assert captured_params[0]["foo"] == "bar"
        assert captured_params[0]["per_page"] == "2"
        assert captured_params[0]["page"] == "1"


# --- get_all_projects ---


class TestGetAllProjects:
    @pytest.fixture
    def config(self, tmp_path):
        return make_config(tmp_path, group="42", per_page=100)

    async def test_fetches_projects_with_subgroups(self, config):
        base_url = f"{API_URL}/groups"

        projects_root = [
            {"id": 1, "name": "proj1", "path_with_namespace": "root-group/proj1"},
        ]
        subgroups_root = [
            {"id": 100, "full_path": "root-group/sub1"},
        ]
        projects_sub = [
            {"id": 2, "name": "proj2", "path_with_namespace": "root-group/sub1/proj2"},
        ]

        async def fake_fetch_paginated(_session, url, _params, _desc, _cfg):
            if url == f"{base_url}/42/projects":
                return projects_root
            if url == f"{base_url}/42/subgroups":
                return subgroups_root
            if url == f"{base_url}/100/projects":
                return projects_sub
            if url == f"{base_url}/100/subgroups":
                return []
            return []

        with patch(
            "gitlab_downloader.client.fetch_paginated", side_effect=fake_fetch_paginated
        ):
            async with aiohttp.ClientSession() as session:
                result = await get_all_projects(session, config, "root-group")

        assert len(result) == 2
        assert result[0]["name"] == "proj1"
        assert result[1]["name"] == "proj2"
        assert result[0]["group_path"] == ""
        assert result[1]["group_path"] == "sub1"

    async def test_no_group_returns_empty(self, tmp_path):
        config = make_config(tmp_path, group=None)
        async with aiohttp.ClientSession() as session:
            result = await get_all_projects(session, config, "")
        assert result == []


# --- get_user_projects ---


class TestGetUserProjects:
    @pytest.fixture
    def config(self, tmp_path):
        return make_config(tmp_path, per_page=100)

    async def test_fetches_user_projects(self, config):
        projects = [
            {"id": 1, "name": "proj1", "path_with_namespace": "user/proj1"},
            {"id": 2, "name": "proj2", "path_with_namespace": "org/team/proj2"},
        ]

        async def fake_fetch_paginated(_session, _url, _params, _desc, _cfg):
            return projects

        with patch(
            "gitlab_downloader.client.fetch_paginated", side_effect=fake_fetch_paginated
        ):
            async with aiohttp.ClientSession() as session:
                result = await get_user_projects(session, config)

        assert len(result) == 2
        assert result[0]["group_path"] == "user"
        assert result[1]["group_path"] == "org/team"

    async def test_project_without_namespace(self, config):
        projects = [
            {"id": 1, "name": "proj1", "path_with_namespace": "solo-project"},
        ]

        async def fake_fetch_paginated(_session, _url, _params, _desc, _cfg):
            return projects

        with patch(
            "gitlab_downloader.client.fetch_paginated", side_effect=fake_fetch_paginated
        ):
            async with aiohttp.ClientSession() as session:
                result = await get_user_projects(session, config)

        assert result[0]["group_path"] == ""
