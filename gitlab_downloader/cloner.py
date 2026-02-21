from __future__ import annotations

import asyncio
import logging
import os
import shutil
from typing import Any, cast
from urllib.parse import urlparse

from .constants import RETRY_BACKOFF_MAX
from .models import CloneResult, GitlabConfig
from .utils import build_authenticated_clone_url, is_subpath, sanitize_path_component

logger = logging.getLogger("gitlab_downloader")
_CREDENTIAL_LOCK = asyncio.Lock()
_CREDENTIAL_READY_HOSTS: set[str] = set()


async def run_git_command(
    *args: str,
    env: dict[str, str] | None = None,
    stdin_text: str | None = None,
) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE if stdin_text is not None else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    payload = stdin_text.encode() if stdin_text is not None else None
    stdout, stderr = await process.communicate(payload)
    return_code = cast(int, process.returncode)
    return (
        return_code,
        stdout.decode(errors="ignore").strip(),
        stderr.decode(errors="ignore").strip(),
    )


async def _ensure_credentials_in_helper(repo_url: str, token: str | None) -> None:
    if not token:
        raise RuntimeError("Token is required for git credential helper mode")

    # Validate token format - should not contain newlines which could cause injection
    if "\n" in token or "\r" in token:
        raise RuntimeError("Token contains invalid characters")

    parsed = urlparse(repo_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise RuntimeError("Credential helper mode supports only https repository urls")

    async with _CREDENTIAL_LOCK:
        if parsed.hostname in _CREDENTIAL_READY_HOSTS:
            return
        approve_payload = (
            f"protocol=https\nhost={parsed.hostname}\nusername=oauth2\npassword={token}\n\n"
        )
        code, _, stderr = await run_git_command(
            "git",
            "credential",
            "approve",
            stdin_text=approve_payload,
        )
        if code != 0:
            raise RuntimeError(f"Unable to store credentials in helper: {stderr[:200]}")
        _CREDENTIAL_READY_HOSTS.add(parsed.hostname)


def build_clone_target(project: dict[str, Any], config: GitlabConfig) -> tuple[str, str]:
    repo_name = sanitize_path_component(str(project.get("name", "unknown-repo"))) or "unknown-repo"
    group_path = sanitize_path_component(str(project.get("group_path", "")))
    parts = [config.clone_path] + ([*group_path.split("/")] if group_path else []) + [repo_name]
    target_path = os.path.join(*parts)
    return repo_name, target_path


async def clone_repository(
    project: dict[str, Any],
    config: GitlabConfig,
    semaphore: asyncio.Semaphore,
    shutdown_event: asyncio.Event,
) -> CloneResult:
    async with semaphore:
        repo_name, full_clone_path = build_clone_target(project, config)
        https_url = project.get("http_url_to_repo")

        if shutdown_event.is_set():
            return CloneResult(name=repo_name, status="skipped", message="Shutdown requested")

        if not https_url:
            logger.warning("Skipping %s: HTTPS URL is missing", repo_name)
            return CloneResult(name=repo_name, status="failed", message="Missing HTTPS URL")

        if not is_subpath(config.clone_path, full_clone_path):
            logger.error("Skipping %s: resolved path is outside clone root", repo_name)
            return CloneResult(name=repo_name, status="failed", message="Unsafe target path")

        os.makedirs(os.path.dirname(full_clone_path), exist_ok=True)

        if os.path.exists(full_clone_path):
            if not config.update_existing:
                logger.info("Skipping %s: already cloned", repo_name)
                return CloneResult(name=repo_name, status="skipped", message="Already cloned")
            if config.git_auth_mode == "credential_helper":
                try:
                    await _ensure_credentials_in_helper(str(https_url), config.token)
                except RuntimeError as exc:
                    return CloneResult(name=repo_name, status="failed", message=str(exc))

            logger.info("Updating %s with git pull --ff-only", repo_name)
            code, _, stderr = await run_git_command(
                "git", "-C", full_clone_path, "pull", "--ff-only"
            )
            if code == 0:
                return CloneResult(name=repo_name, status="updated", message="Updated successfully")
            return CloneResult(
                name=repo_name,
                status="failed",
                message=f"Update failed: {stderr[:200]}",
            )

        try:
            if config.git_auth_mode == "credential_helper":
                await _ensure_credentials_in_helper(str(https_url), config.token)
                clone_url = str(https_url)
            else:
                clone_url = build_authenticated_clone_url(str(https_url), config.token or "")
        except (ValueError, RuntimeError) as exc:
            logger.error("Skipping %s: %s", repo_name, exc)
            return CloneResult(name=repo_name, status="failed", message=str(exc))

        logger.info("Cloning %s into %s", repo_name, full_clone_path)

        total_attempts = config.clone_retries + 1
        delay = 1
        stderr = ""
        for attempt in range(1, total_attempts + 1):
            code, _, stderr = await run_git_command("git", "clone", clone_url, full_clone_path)
            if code == 0:
                logger.info("Repository %s cloned successfully", repo_name)
                return CloneResult(name=repo_name, status="success", message="Cloned")

            logger.warning(
                "Clone failed for %s on attempt %s/%s: %s",
                repo_name,
                attempt,
                total_attempts,
                stderr[:200],
            )
            shutil.rmtree(full_clone_path, ignore_errors=True)

            if attempt < total_attempts:
                await asyncio.sleep(delay)
                delay = min(delay * 2, RETRY_BACKOFF_MAX)

        return CloneResult(name=repo_name, status="failed", message=f"Clone failed: {stderr[:200]}")


async def clone_all_repositories(
    projects: list[dict[str, Any]],
    config: GitlabConfig,
    shutdown_event: asyncio.Event,
) -> list[CloneResult]:
    semaphore = asyncio.Semaphore(config.max_concurrency)
    tasks = [clone_repository(project, config, semaphore, shutdown_event) for project in projects]
    return await asyncio.gather(*tasks)
