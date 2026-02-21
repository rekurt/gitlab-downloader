from __future__ import annotations

import asyncio
import logging
import random
import time
from collections import deque
from typing import Any, cast
from urllib.parse import quote

import aiohttp

from .constants import GITLAB_API_VERSION, RETRY_BACKOFF_MAX
from .models import GitlabConfig
from .utils import extract_group_path

logger = logging.getLogger("gitlab_downloader")


def _header_get(headers: aiohttp.typedefs.LooseHeaders, name: str) -> str | None:
    mapping = cast(Any, headers)
    if not hasattr(mapping, "get"):
        return None
    value = mapping.get(name)
    return str(value) if value is not None else None


def maybe_rate_limit_delay(headers: aiohttp.typedefs.LooseHeaders) -> float:
    remaining_raw = _header_get(headers, "RateLimit-Remaining")
    reset_raw = _header_get(headers, "RateLimit-Reset")
    if not remaining_raw or not reset_raw:
        return 0.0

    try:
        remaining = int(str(remaining_raw))
        reset_at = int(str(reset_raw))
    except ValueError:
        return 0.0

    if remaining >= 10:
        return 0.0

    now = int(time.time())
    wait_seconds = max(reset_at - now, 1)
    return float(min(wait_seconds, 30))


def _retry_after_seconds(headers: aiohttp.typedefs.LooseHeaders) -> float | None:
    raw = _header_get(headers, "Retry-After")
    if raw is None:
        return None
    try:
        value = float(str(raw))
    except ValueError:
        return None
    return max(0.0, min(value, RETRY_BACKOFF_MAX))


def _next_delay(base_delay: float, headers: aiohttp.typedefs.LooseHeaders) -> float:
    retry_after = _retry_after_seconds(headers)
    if retry_after is not None:
        return retry_after
    jitter = random.uniform(0.05, 0.5)
    return min(base_delay + jitter, RETRY_BACKOFF_MAX)


async def fetch_json(
    session: aiohttp.ClientSession,
    url: str,
    params: dict[str, str],
    description: str,
    config: GitlabConfig,
) -> list[dict] | dict | None:
    delay = 1.0
    timeout = aiohttp.ClientTimeout(total=config.request_timeout)

    for attempt in range(1, config.max_retries + 1):
        try:
            async with session.get(url, params=params, timeout=timeout) as response:
                if response.status == 429 or response.status >= 500:
                    text = await response.text()
                    logger.warning(
                        "%s attempt %s failed with status %s: %s",
                        description,
                        attempt,
                        response.status,
                        text[:200],
                    )
                    await asyncio.sleep(_next_delay(delay, response.headers))
                    delay = min(delay * 2, RETRY_BACKOFF_MAX)
                    continue

                if response.status != 200:
                    text = await response.text()
                    logger.error(
                        "Failed to fetch %s: %s %s",
                        description,
                        response.status,
                        text[:200],
                    )
                    return None

                pause = maybe_rate_limit_delay(response.headers)
                if pause > 0:
                    logger.warning("Rate limit is low, sleeping %.1f seconds", pause)
                    await asyncio.sleep(pause)

                return await response.json()
        except asyncio.TimeoutError:
            logger.warning("Timeout fetching %s (attempt %s)", description, attempt)
        except Exception as exc:
            logger.warning("Error fetching %s (attempt %s): %s", description, attempt, exc)

        await asyncio.sleep(min(delay + random.uniform(0.05, 0.5), RETRY_BACKOFF_MAX))
        delay = min(delay * 2, RETRY_BACKOFF_MAX)

    logger.error("Giving up on %s after %s attempts", description, config.max_retries)
    return None


async def fetch_paginated(
    session: aiohttp.ClientSession,
    url: str,
    base_params: dict[str, str],
    description: str,
    config: GitlabConfig,
) -> list[dict]:
    page = 1
    results: list[dict] = []

    while True:
        params = {**base_params, "per_page": str(config.per_page), "page": str(page)}
        data = await fetch_json(session, url, params, f"{description} page {page}", config)
        if data is None:
            break
        if not isinstance(data, list):
            logger.error("Unexpected payload for %s page %s", description, page)
            break
        if not data:
            break

        results.extend(data)
        if len(data) < config.per_page:
            break
        page += 1

    return results


async def fetch_group_metadata(session: aiohttp.ClientSession, config: GitlabConfig) -> dict:
    if not config.group:
        raise RuntimeError("Group is not set")
    encoded_group = quote(config.group, safe="")
    url = f"{config.url}/api/{GITLAB_API_VERSION}/groups/{encoded_group}"
    data = await fetch_json(session, url, {}, "group metadata", config)
    if data is None or not isinstance(data, dict):
        raise RuntimeError("Unable to fetch group metadata. Check group and token permissions")
    return data


async def get_all_projects(
    session: aiohttp.ClientSession,
    config: GitlabConfig,
    root_full_path: str,
) -> list[dict]:
    if not config.group:
        return []
    base_url = f"{config.url}/api/{GITLAB_API_VERSION}/groups"
    projects: list[dict] = []
    to_visit: deque[dict[str, str]] = deque([{"id": config.group, "full_path": root_full_path}])

    while to_visit:
        current = to_visit.popleft()
        group_id = current["id"]
        group_path = current["full_path"]
        logger.info("Fetching projects for group %s (%s)", group_path, group_id)

        # Encode group ID if it's a path-based identifier (contains /)
        encoded_group_id = quote(str(group_id), safe="")

        project_items = await fetch_paginated(
            session,
            f"{base_url}/{encoded_group_id}/projects",
            {"include_subgroups": "false"},
            f"projects for group {group_path}",
            config,
        )

        for project in project_items:
            path_with_namespace = project.get("path_with_namespace", "")
            project["group_path"] = extract_group_path(root_full_path, path_with_namespace)
            projects.append(project)

        subgroups = await fetch_paginated(
            session,
            f"{base_url}/{encoded_group_id}/subgroups",
            {},
            f"subgroups for group {group_path}",
            config,
        )

        for subgroup in subgroups:
            subgroup_id = str(subgroup["id"])
            subgroup_path = subgroup.get("full_path") or subgroup.get("path") or subgroup_id
            to_visit.append({"id": subgroup_id, "full_path": subgroup_path})

    return projects


async def get_user_projects(session: aiohttp.ClientSession, config: GitlabConfig) -> list[dict]:
    projects = await fetch_paginated(
        session,
        f"{config.url}/api/{GITLAB_API_VERSION}/projects",
        {"membership": "true", "simple": "true"},
        "projects for current user",
        config,
    )

    for project in projects:
        path_with_namespace = str(project.get("path_with_namespace", ""))
        parent = path_with_namespace.rsplit("/", 1)[0] if "/" in path_with_namespace else ""
        project["group_path"] = parent

    return projects
