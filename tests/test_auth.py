from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiohttp
import pytest
from aioresponses import aioresponses

from gitlab_downloader.auth import (
    _cache_matches,
    _normalize_oauth_payload,
    _read_cache,
    _safe_scope,
    _token_valid,
    _write_cache,
    resolve_access_token,
)
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
        "interactive_menu": False,
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


def _make_cached_payload(
    *,
    instance_url: str = "https://gitlab.com",
    client_id: str = "cid",
    scope: str = "read_api read_repository",
    access_token: str = "cached-token",
    refresh_token: str = "refresh-tok",
    expires_at: int | None = None,
) -> dict:
    if expires_at is None:
        expires_at = int(time.time()) + 7200
    return {
        "instance_url": instance_url,
        "client_id": client_id,
        "scope": scope,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "Bearer",
        "expires_at": expires_at,
    }


# --- _safe_scope ---


class TestSafeScope:
    def test_normalizes_whitespace(self):
        assert _safe_scope("read_api   read_repository") == "read_api read_repository"

    def test_strips_empty_parts(self):
        assert _safe_scope("  read_api  ") == "read_api"

    def test_empty_string(self):
        assert _safe_scope("") == ""


# --- _read_cache / _write_cache ---


class TestCacheReadWrite:
    def test_read_nonexistent_returns_none(self, tmp_path):
        assert _read_cache(str(tmp_path / "missing.json")) is None

    def test_write_then_read(self, tmp_path):
        path = str(tmp_path / "cache.json")
        payload = {"access_token": "tok", "expires_at": 123}
        _write_cache(path, payload)
        result = _read_cache(path)
        assert result == payload

    def test_read_invalid_json_returns_none(self, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text("not json!", encoding="utf-8")
        assert _read_cache(str(path)) is None

    def test_write_creates_parent_dirs(self, tmp_path):
        path = str(tmp_path / "sub" / "dir" / "cache.json")
        _write_cache(path, {"key": "value"})
        result = _read_cache(path)
        assert result == {"key": "value"}


# --- _token_valid ---


class TestTokenValid:
    def test_valid_token(self):
        payload = {"access_token": "tok", "expires_at": int(time.time()) + 3600}
        assert _token_valid(payload) is True

    def test_expired_token(self):
        payload = {"access_token": "tok", "expires_at": int(time.time()) - 100}
        assert _token_valid(payload) is False

    def test_nearly_expired_within_min_ttl(self):
        payload = {"access_token": "tok", "expires_at": int(time.time()) + 30}
        assert _token_valid(payload, min_ttl=60) is False

    def test_missing_access_token(self):
        payload = {"expires_at": int(time.time()) + 3600}
        assert _token_valid(payload) is False

    def test_missing_expires_at(self):
        payload = {"access_token": "tok"}
        assert _token_valid(payload) is False

    def test_non_int_expires_at(self):
        payload = {"access_token": "tok", "expires_at": "not-an-int"}
        assert _token_valid(payload) is False


# --- _cache_matches ---


class TestCacheMatches:
    def test_matching(self, tmp_path):
        cfg = make_config(tmp_path, oauth_client_id="cid", oauth_scope="read_api read_repository")
        cached = _make_cached_payload(client_id="cid", scope="read_api read_repository")
        assert _cache_matches(cfg, cached) is True

    def test_different_url(self, tmp_path):
        cfg = make_config(tmp_path, url="https://other.gitlab.com", oauth_client_id="cid")
        cached = _make_cached_payload(instance_url="https://gitlab.com", client_id="cid")
        assert _cache_matches(cfg, cached) is False

    def test_different_client_id(self, tmp_path):
        cfg = make_config(tmp_path, oauth_client_id="other-cid")
        cached = _make_cached_payload(client_id="cid")
        assert _cache_matches(cfg, cached) is False

    def test_different_scope(self, tmp_path):
        cfg = make_config(tmp_path, oauth_client_id="cid", oauth_scope="api")
        cached = _make_cached_payload(client_id="cid", scope="read_api read_repository")
        assert _cache_matches(cfg, cached) is False


# --- _normalize_oauth_payload ---


class TestNormalizeOauthPayload:
    def test_normalizes_payload(self, tmp_path):
        cfg = make_config(tmp_path, oauth_client_id="cid", oauth_scope="read_api  read_repository")
        raw = {
            "access_token": "new-tok",
            "refresh_token": "new-ref",
            "token_type": "Bearer",
            "expires_in": 7200,
        }
        result = _normalize_oauth_payload(cfg, raw)
        assert result["access_token"] == "new-tok"
        assert result["refresh_token"] == "new-ref"
        assert result["instance_url"] == "https://gitlab.com"
        assert result["client_id"] == "cid"
        assert result["scope"] == "read_api read_repository"
        assert result["expires_at"] > int(time.time())

    def test_defaults_expires_in(self, tmp_path):
        cfg = make_config(tmp_path, oauth_client_id="cid")
        raw = {"access_token": "tok"}
        result = _normalize_oauth_payload(cfg, raw)
        assert result["expires_at"] > int(time.time())
        assert result["token_type"] == "Bearer"


# --- resolve_access_token: token mode ---


class TestResolveTokenMode:
    @pytest.mark.asyncio
    async def test_returns_token(self, tmp_path):
        cfg = make_config(tmp_path, auth_method="token", token="abc")
        token = await resolve_access_token(cfg)
        assert token == "abc"

    @pytest.mark.asyncio
    async def test_missing_token_raises(self, tmp_path):
        cfg = make_config(tmp_path, auth_method="token", token=None)
        with pytest.raises(RuntimeError, match="token is missing"):
            await resolve_access_token(cfg)


# --- resolve_access_token: OAuth with valid cache ---


class TestResolveOauthCached:
    @pytest.mark.asyncio
    async def test_uses_cached_token(self, tmp_path):
        cache_path = tmp_path / "oauth.json"
        payload = _make_cached_payload(expires_at=int(time.time()) + 7200)
        cache_path.write_text(json.dumps(payload), encoding="utf-8")

        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id="cid",
            oauth_cache_path=str(cache_path),
        )
        token = await resolve_access_token(cfg)
        assert token == "cached-token"

    @pytest.mark.asyncio
    async def test_missing_client_id_raises(self, tmp_path):
        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id=None,
        )
        with pytest.raises(RuntimeError, match="oauth client id is missing"):
            await resolve_access_token(cfg)


# --- resolve_access_token: OAuth refresh flow ---


class TestResolveOauthRefresh:
    @pytest.mark.asyncio
    async def test_refresh_success(self, tmp_path):
        cache_path = tmp_path / "oauth.json"
        # Expired cache with refresh token
        expired_cache = _make_cached_payload(
            expires_at=int(time.time()) - 100,
            refresh_token="old-refresh",
        )
        cache_path.write_text(json.dumps(expired_cache), encoding="utf-8")

        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id="cid",
            oauth_cache_path=str(cache_path),
        )

        refresh_response = {
            "access_token": "refreshed-token",
            "refresh_token": "new-refresh",
            "token_type": "Bearer",
            "expires_in": 7200,
        }

        with aioresponses() as mocked:
            mocked.post("https://gitlab.com/oauth/token", payload=refresh_response)
            token = await resolve_access_token(cfg)

        assert token == "refreshed-token"
        # Verify cache was updated
        updated_cache = json.loads(cache_path.read_text(encoding="utf-8"))
        assert updated_cache["access_token"] == "refreshed-token"

    @pytest.mark.asyncio
    async def test_refresh_failure_falls_through_to_device_flow(self, tmp_path):
        cache_path = tmp_path / "oauth.json"
        expired_cache = _make_cached_payload(
            expires_at=int(time.time()) - 100,
            refresh_token="old-refresh",
        )
        cache_path.write_text(json.dumps(expired_cache), encoding="utf-8")

        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id="cid",
            oauth_cache_path=str(cache_path),
        )

        device_auth_response = {
            "device_code": "dev-code",
            "user_code": "USER-123",
            "verification_uri": "https://gitlab.com/oauth/authorize_device",
            "verification_uri_complete": "https://gitlab.com/oauth/authorize_device?user_code=USER-123",
            "interval": 1,
            "expires_in": 300,
        }

        token_response = {
            "access_token": "device-token",
            "refresh_token": "device-refresh",
            "token_type": "Bearer",
            "expires_in": 7200,
        }

        with aioresponses() as mocked:
            # Refresh fails
            mocked.post("https://gitlab.com/oauth/token", status=401, body="invalid")
            # Device authorize
            mocked.post("https://gitlab.com/oauth/authorize_device", payload=device_auth_response)
            # Poll succeeds immediately
            mocked.post("https://gitlab.com/oauth/token", payload=token_response)

            with patch("gitlab_downloader.auth.print"):
                token = await resolve_access_token(cfg)

        assert token == "device-token"


# --- resolve_access_token: OAuth device flow ---


class TestResolveOauthDeviceFlow:
    @pytest.mark.asyncio
    async def test_device_flow_with_verification_uri_complete(self, tmp_path):
        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id="cid",
            oauth_cache_path=str(tmp_path / "oauth.json"),
        )

        device_auth_response = {
            "device_code": "dev-code",
            "user_code": "USER-123",
            "verification_uri": "https://gitlab.com/oauth/authorize_device",
            "verification_uri_complete": "https://gitlab.com/oauth/authorize_device?user_code=USER-123",
            "interval": 1,
            "expires_in": 300,
        }

        token_response = {
            "access_token": "device-token",
            "refresh_token": "device-refresh",
            "token_type": "Bearer",
            "expires_in": 7200,
        }

        with aioresponses() as mocked:
            mocked.post("https://gitlab.com/oauth/authorize_device", payload=device_auth_response)
            mocked.post("https://gitlab.com/oauth/token", payload=token_response)

            with patch("gitlab_downloader.auth.print") as mock_print:
                token = await resolve_access_token(cfg)

        assert token == "device-token"
        mock_print.assert_called_once()
        assert "Open in browser" in mock_print.call_args[0][0]

    @pytest.mark.asyncio
    async def test_device_flow_with_user_code(self, tmp_path):
        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id="cid",
            oauth_cache_path=str(tmp_path / "oauth.json"),
        )

        device_auth_response = {
            "device_code": "dev-code",
            "user_code": "USER-123",
            "verification_uri": "https://gitlab.com/oauth/authorize_device",
            "interval": 1,
            "expires_in": 300,
        }

        token_response = {
            "access_token": "device-token",
            "refresh_token": "device-refresh",
            "token_type": "Bearer",
            "expires_in": 7200,
        }

        with aioresponses() as mocked:
            mocked.post("https://gitlab.com/oauth/authorize_device", payload=device_auth_response)
            mocked.post("https://gitlab.com/oauth/token", payload=token_response)

            with patch("gitlab_downloader.auth.print") as mock_print:
                token = await resolve_access_token(cfg)

        assert token == "device-token"
        assert mock_print.call_count == 2

    @pytest.mark.asyncio
    async def test_device_flow_missing_device_code_raises(self, tmp_path):
        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id="cid",
            oauth_cache_path=str(tmp_path / "oauth.json"),
        )

        device_auth_response = {
            "user_code": "USER-123",
            "verification_uri": "https://gitlab.com/oauth/authorize_device",
            "interval": 1,
            "expires_in": 300,
        }

        with aioresponses() as mocked:
            mocked.post("https://gitlab.com/oauth/authorize_device", payload=device_auth_response)

            with pytest.raises(RuntimeError, match="missing device_code"):
                await resolve_access_token(cfg)

    @pytest.mark.asyncio
    async def test_device_flow_missing_verification_url_raises(self, tmp_path):
        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id="cid",
            oauth_cache_path=str(tmp_path / "oauth.json"),
        )

        device_auth_response = {
            "device_code": "dev-code",
            "interval": 1,
            "expires_in": 300,
        }

        with aioresponses() as mocked:
            mocked.post("https://gitlab.com/oauth/authorize_device", payload=device_auth_response)

            with pytest.raises(RuntimeError, match="missing verification url"):
                await resolve_access_token(cfg)

    @pytest.mark.asyncio
    async def test_device_authorize_failure_raises(self, tmp_path):
        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id="cid",
            oauth_cache_path=str(tmp_path / "oauth.json"),
        )

        with aioresponses() as mocked:
            mocked.post("https://gitlab.com/oauth/authorize_device", status=400, body="bad request")

            with pytest.raises(RuntimeError, match="Device authorization failed"):
                await resolve_access_token(cfg)


# --- _poll_device_token ---


class TestPollDeviceToken:
    @pytest.mark.asyncio
    async def test_authorization_pending_then_success(self, tmp_path):
        from gitlab_downloader.auth import _poll_device_token

        cfg = make_config(tmp_path, oauth_client_id="cid")

        pending_body = json.dumps({"error": "authorization_pending"})
        token_response = {
            "access_token": "polled-token",
            "refresh_token": "polled-refresh",
            "expires_in": 7200,
        }

        with aioresponses() as mocked:
            mocked.post(
                "https://gitlab.com/oauth/token",
                status=400,
                body=pending_body,
                content_type="application/json",
            )
            mocked.post("https://gitlab.com/oauth/token", payload=token_response)

            with patch("gitlab_downloader.auth.asyncio_sleep", new_callable=AsyncMock):
                async with aiohttp.ClientSession() as session:
                    result = await _poll_device_token(session, cfg, "dev-code", 1, 60)

        assert result["access_token"] == "polled-token"

    @pytest.mark.asyncio
    async def test_slow_down_increases_interval(self, tmp_path):
        from gitlab_downloader.auth import _poll_device_token

        cfg = make_config(tmp_path, oauth_client_id="cid")

        slow_body = json.dumps({"error": "slow_down"})
        token_response = {
            "access_token": "polled-token",
            "refresh_token": "polled-refresh",
            "expires_in": 7200,
        }

        with aioresponses() as mocked:
            mocked.post(
                "https://gitlab.com/oauth/token",
                status=400,
                body=slow_body,
                content_type="application/json",
            )
            mocked.post("https://gitlab.com/oauth/token", payload=token_response)

            mock_sleep = AsyncMock()
            with patch("gitlab_downloader.auth.asyncio_sleep", mock_sleep):
                async with aiohttp.ClientSession() as session:
                    result = await _poll_device_token(session, cfg, "dev-code", 1, 60)

        assert result["access_token"] == "polled-token"
        # slow_down increases wait by 2
        assert mock_sleep.call_args_list[0][0][0] == 3

    @pytest.mark.asyncio
    async def test_unknown_error_raises(self, tmp_path):
        from gitlab_downloader.auth import _poll_device_token

        cfg = make_config(tmp_path, oauth_client_id="cid")

        error_body = json.dumps({"error": "access_denied"})

        with aioresponses() as mocked:
            mocked.post(
                "https://gitlab.com/oauth/token",
                status=400,
                body=error_body,
                content_type="application/json",
            )

            async with aiohttp.ClientSession() as session:
                with pytest.raises(RuntimeError, match="Device token polling failed"):
                    await _poll_device_token(session, cfg, "dev-code", 1, 60)

    @pytest.mark.asyncio
    async def test_expired_deadline_raises(self, tmp_path):
        from gitlab_downloader.auth import _poll_device_token

        cfg = make_config(tmp_path, oauth_client_id="cid")

        # Mock _now so that deadline is immediately in the past
        call_count = 0

        def fake_now():
            nonlocal call_count
            call_count += 1
            # First call sets deadline = 1000 + 1 = 1001
            # Second call returns 2000 (past deadline)
            return 1000 if call_count == 1 else 2000

        with patch("gitlab_downloader.auth._now", side_effect=fake_now):
            async with aiohttp.ClientSession() as session:
                with pytest.raises(RuntimeError, match="expired before completion"):
                    await _poll_device_token(session, cfg, "dev-code", 1, 1)


# --- resolve_access_token: OAuth with client_secret ---


class TestResolveOauthWithClientSecret:
    @pytest.mark.asyncio
    async def test_refresh_sends_client_secret(self, tmp_path):
        cache_path = tmp_path / "oauth.json"
        expired_cache = _make_cached_payload(expires_at=int(time.time()) - 100)
        cache_path.write_text(json.dumps(expired_cache), encoding="utf-8")

        cfg = make_config(
            tmp_path,
            auth_method="oauth",
            token=None,
            oauth_client_id="cid",
            oauth_client_secret="secret123",
            oauth_cache_path=str(cache_path),
        )

        refresh_response = {
            "access_token": "refreshed-token",
            "refresh_token": "new-refresh",
            "token_type": "Bearer",
            "expires_in": 7200,
        }

        captured_body: dict[str, str] = {}

        def capture_callback(url, **kwargs):
            data = kwargs.get("data", {})
            captured_body.update(data)
            return aioresponses_module.CallbackResult(
                payload=refresh_response,
            )

        import aioresponses as aioresponses_module

        with aioresponses() as mocked:
            mocked.post(
                "https://gitlab.com/oauth/token",
                callback=capture_callback,
            )

            token = await resolve_access_token(cfg)

        assert token == "refreshed-token"
        assert captured_body.get("client_secret") == "secret123"
        assert captured_body.get("grant_type") == "refresh_token"
