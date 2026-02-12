from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import aiohttp

from .constants import RETRY_BACKOFF_MAX
from .models import GitlabConfig

logger = logging.getLogger("gitlab_downloader")

DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
REFRESH_GRANT_TYPE = "refresh_token"


def _now() -> int:
    return int(time.time())


def _safe_scope(scope: str) -> str:
    return " ".join(part for part in scope.split() if part)


def _cache_file(path: str) -> Path:
    cache = Path(path).expanduser()
    cache.parent.mkdir(parents=True, exist_ok=True)
    return cache


def _read_cache(path: str) -> dict[str, Any] | None:
    cache = _cache_file(path)
    if not cache.exists():
        return None
    try:
        return json.loads(cache.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_cache(path: str, payload: dict[str, Any]) -> None:
    cache = _cache_file(path)
    cache.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def _token_valid(payload: dict[str, Any], min_ttl: int = 60) -> bool:
    token = payload.get("access_token")
    expires_at = payload.get("expires_at")
    if not token:
        return False
    if not isinstance(expires_at, int):
        return False
    return (_now() + min_ttl) < expires_at


async def _request_token(
    session: aiohttp.ClientSession,
    gitlab_url: str,
    data: dict[str, str],
) -> dict[str, Any] | None:
    url = f"{gitlab_url}/oauth/token"
    async with session.post(url, data=data, timeout=aiohttp.ClientTimeout(total=30)) as response:
        if response.status != 200:
            text = await response.text()
            logger.warning("OAuth token endpoint error: %s %s", response.status, text[:200])
            return None
        return await response.json()


async def _refresh_token(
    session: aiohttp.ClientSession,
    config: GitlabConfig,
    refresh_token: str,
) -> dict[str, Any] | None:
    data = {
        "grant_type": REFRESH_GRANT_TYPE,
        "refresh_token": refresh_token,
        "client_id": config.oauth_client_id or "",
    }
    if config.oauth_client_secret:
        data["client_secret"] = config.oauth_client_secret
    payload = await _request_token(session, config.url, data)
    if not payload or "access_token" not in payload:
        return None
    return payload


async def _device_authorize(session: aiohttp.ClientSession, config: GitlabConfig) -> dict[str, Any]:
    url = f"{config.url}/oauth/authorize_device"
    data = {
        "client_id": config.oauth_client_id or "",
        "scope": _safe_scope(config.oauth_scope),
    }
    async with session.post(url, data=data, timeout=aiohttp.ClientTimeout(total=30)) as response:
        text = await response.text()
        if response.status != 200:
            raise RuntimeError(f"Device authorization failed: {response.status} {text[:200]}")
        return json.loads(text)


async def _poll_device_token(
    session: aiohttp.ClientSession,
    config: GitlabConfig,
    device_code: str,
    interval: int,
    expires_in: int,
) -> dict[str, Any]:
    deadline = _now() + max(1, expires_in)
    wait_seconds = max(1, interval)

    while _now() < deadline:
        data = {
            "grant_type": DEVICE_GRANT_TYPE,
            "device_code": device_code,
            "client_id": config.oauth_client_id or "",
        }
        if config.oauth_client_secret:
            data["client_secret"] = config.oauth_client_secret

        async with session.post(
            f"{config.url}/oauth/token",
            data=data,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as response:
            body = await response.json(content_type=None)
            if response.status == 200 and isinstance(body, dict) and body.get("access_token"):
                return body

            error = str(body.get("error", "")) if isinstance(body, dict) else ""
            if error == "authorization_pending":
                await asyncio_sleep(wait_seconds)
                continue
            if error == "slow_down":
                wait_seconds = min(wait_seconds + 2, RETRY_BACKOFF_MAX)
                await asyncio_sleep(wait_seconds)
                continue
            raise RuntimeError(f"Device token polling failed: {error or response.status}")

    raise RuntimeError("Device authorization expired before completion")


async def asyncio_sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)


def _normalize_oauth_payload(
    config: GitlabConfig,
    payload: dict[str, Any],
) -> dict[str, Any]:
    expires_in = int(payload.get("expires_in", 3600))
    return {
        "instance_url": config.url,
        "client_id": config.oauth_client_id,
        "scope": _safe_scope(config.oauth_scope),
        "access_token": payload.get("access_token"),
        "refresh_token": payload.get("refresh_token"),
        "token_type": payload.get("token_type", "Bearer"),
        "expires_at": _now() + max(1, expires_in),
    }


def _cache_matches(config: GitlabConfig, cached: dict[str, Any]) -> bool:
    return (
        cached.get("instance_url") == config.url
        and cached.get("client_id") == config.oauth_client_id
        and cached.get("scope") == _safe_scope(config.oauth_scope)
    )


async def resolve_access_token(config: GitlabConfig) -> str:
    if config.auth_method == "token":
        if not config.token:
            raise RuntimeError("Token auth is selected but token is missing")
        return config.token

    if not config.oauth_client_id:
        raise RuntimeError("OAuth auth is selected but oauth client id is missing")

    cached = _read_cache(config.oauth_cache_path)
    if cached and _cache_matches(config, cached) and _token_valid(cached):
        return str(cached["access_token"])

    async with aiohttp.ClientSession() as session:
        if cached and _cache_matches(config, cached):
            refresh_token = cached.get("refresh_token")
            if isinstance(refresh_token, str) and refresh_token:
                refreshed = await _refresh_token(session, config, refresh_token)
                if refreshed:
                    normalized = _normalize_oauth_payload(config, refreshed)
                    _write_cache(config.oauth_cache_path, normalized)
                    return str(normalized["access_token"])

        device_data = await _device_authorize(session, config)
        verification_uri = str(device_data.get("verification_uri") or "")
        verification_uri_complete = str(device_data.get("verification_uri_complete") or "")
        user_code = str(device_data.get("user_code") or "")
        interval = int(device_data.get("interval", 5))
        expires_in = int(device_data.get("expires_in", 300))
        device_code = str(device_data.get("device_code") or "")

        if not device_code:
            raise RuntimeError("OAuth device flow failed: missing device_code")

        if verification_uri_complete:
            print(f"Open in browser: {verification_uri_complete}")
        elif verification_uri and user_code:
            print(f"Open in browser: {verification_uri}")
            print(f"Enter code: {user_code}")
        else:
            raise RuntimeError("OAuth device flow failed: missing verification url")

        token_payload = await _poll_device_token(session, config, device_code, interval, expires_in)
        normalized = _normalize_oauth_payload(config, token_payload)
        _write_cache(config.oauth_cache_path, normalized)
        return str(normalized["access_token"])
