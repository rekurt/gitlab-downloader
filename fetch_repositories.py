from __future__ import annotations

import argparse
import asyncio
import logging
import os
import shutil
import signal
import sys
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse

import aiohttp
from dotenv import load_dotenv

GITLAB_API_VERSION = "v4"
DEFAULT_CLONE_PATH = "repositories"
DEFAULT_PER_PAGE = 100
DEFAULT_TIMEOUT = 30
DEFAULT_API_RETRIES = 3
DEFAULT_CLONE_RETRIES = 2
DEFAULT_CONCURRENCY = 5
MIN_CONCURRENCY = 1
MAX_CONCURRENCY = 50
CLONE_RETRY_BACKOFF_MAX = 10

logger = logging.getLogger("gitlab_downloader")


@dataclass
class GitlabConfig:
    url: str
    token: str
    group: str
    clone_path: str = DEFAULT_CLONE_PATH
    per_page: int = DEFAULT_PER_PAGE
    request_timeout: int = DEFAULT_TIMEOUT
    max_retries: int = DEFAULT_API_RETRIES
    clone_retries: int = DEFAULT_CLONE_RETRIES
    max_concurrency: int = DEFAULT_CONCURRENCY
    dry_run: bool = False
    update_existing: bool = False
    log_level: str = "INFO"
    log_file: str | None = None


@dataclass
class CloneResult:
    name: str
    status: str
    message: str


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def setup_logging(level: str, log_file: str | None = None) -> None:
    root = logging.getLogger()
    root.handlers.clear()

    resolved_level = getattr(logging, level.upper(), logging.INFO)
    root.setLevel(resolved_level)

    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    root.addHandler(stream_handler)

    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)


def validate_gitlab_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.hostname)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch and clone all projects from a GitLab group")
    parser.add_argument("--url", default=os.getenv("GITLAB_URL"))
    parser.add_argument("--token", default=os.getenv("GITLAB_TOKEN"))
    parser.add_argument("--group", default=os.getenv("GITLAB_GROUP"))
    parser.add_argument("--clone-path", default=os.getenv("CLONE_PATH", DEFAULT_CLONE_PATH))
    parser.add_argument(
        "--concurrency",
        type=int,
        default=int(
            os.getenv("MAX_CONCURRENCY", DEFAULT_CONCURRENCY),
        ),
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=int(
            os.getenv("REQUEST_TIMEOUT", DEFAULT_TIMEOUT),
        ),
    )
    parser.add_argument(
        "--per-page",
        type=int,
        default=int(
            os.getenv("PER_PAGE", DEFAULT_PER_PAGE),
        ),
    )
    parser.add_argument(
        "--api-retries",
        type=int,
        default=int(
            os.getenv("MAX_RETRIES", DEFAULT_API_RETRIES),
        ),
    )
    parser.add_argument(
        "--clone-retries",
        type=int,
        default=int(
            os.getenv("CLONE_RETRIES", DEFAULT_CLONE_RETRIES),
        ),
    )
    parser.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "INFO"))
    parser.add_argument("--log-file", default=os.getenv("LOG_FILE"))
    parser.add_argument("--dry-run", action="store_true", default=env_bool("DRY_RUN", False))
    parser.add_argument("--update", action="store_true", default=env_bool("UPDATE_EXISTING", False))

    args = parser.parse_args(argv)

    missing = []
    if not args.url:
        missing.append("--url / GITLAB_URL")
    if not args.token:
        missing.append("--token / GITLAB_TOKEN")
    if not args.group:
        missing.append("--group / GITLAB_GROUP")

    if missing:
        parser.error(f"Missing required settings: {', '.join(missing)}")

    if not validate_gitlab_url(args.url):
        parser.error("Invalid --url value: expected http(s)://host")

    if args.concurrency < MIN_CONCURRENCY or args.concurrency > MAX_CONCURRENCY:
        parser.error(f"--concurrency must be in range {MIN_CONCURRENCY}..{MAX_CONCURRENCY}")

    if args.timeout <= 0:
        parser.error("--timeout must be greater than 0")

    if args.per_page <= 0:
        parser.error("--per-page must be greater than 0")

    if args.api_retries < 0:
        parser.error("--api-retries must be >= 0")

    if args.clone_retries < 0:
        parser.error("--clone-retries must be >= 0")

    return args


def config_from_args(args: argparse.Namespace) -> GitlabConfig:
    return GitlabConfig(
        url=args.url.rstrip("/"),
        token=args.token,
        group=args.group,
        clone_path=args.clone_path,
        per_page=args.per_page,
        request_timeout=args.timeout,
        max_retries=args.api_retries,
        clone_retries=args.clone_retries,
        max_concurrency=args.concurrency,
        dry_run=args.dry_run,
        update_existing=args.update,
        log_level=args.log_level,
        log_file=args.log_file,
    )


def trim_prefix(value: str, prefix: str) -> str:
    normalized_value = value.strip("/")
    normalized_prefix = prefix.strip("/")
    if normalized_prefix and normalized_value.startswith(normalized_prefix):
        return normalized_value[len(normalized_prefix) :].strip("/")
    return normalized_value


def sanitize_path_component(value: str) -> str:
    cleaned = value.replace("\\", "/").replace("\x00", "")
    cleaned = "".join(ch for ch in cleaned if ch >= " " and ord(ch) != 127)
    parts = [part for part in cleaned.split("/") if part and part not in {".", ".."}]
    return "/".join(parts)


def extract_group_path(root_full_path: str, path_with_namespace: str) -> str:
    parent = path_with_namespace.rsplit("/", 1)[0] if "/" in path_with_namespace else ""
    return trim_prefix(parent, root_full_path)


def is_subpath(base_path: str, target_path: str) -> bool:
    base_real = os.path.realpath(base_path)
    target_real = os.path.realpath(target_path)
    return os.path.commonpath([base_real, target_real]) == base_real


def build_authenticated_clone_url(https_url: str, token: str) -> str:
    parsed = urlparse(https_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Invalid repository URL")

    encoded_token = quote(token, safe="")
    host = parsed.hostname
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"oauth2:{encoded_token}@{host}{port}"
    return urlunparse(
        (parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment)
    )


def maybe_rate_limit_delay(headers: aiohttp.typedefs.LooseHeaders) -> float:
    remaining_raw = headers.get("RateLimit-Remaining")
    reset_raw = headers.get("RateLimit-Reset")
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


async def fetch_json(
    session: aiohttp.ClientSession,
    url: str,
    params: dict[str, str],
    description: str,
    config: GitlabConfig,
) -> list[dict] | dict | None:
    delay = 1
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
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, CLONE_RETRY_BACKOFF_MAX)
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

        await asyncio.sleep(delay)
        delay = min(delay * 2, CLONE_RETRY_BACKOFF_MAX)

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
    url = f"{config.url}/api/{GITLAB_API_VERSION}/groups/{config.group}"
    data = await fetch_json(session, url, {}, "group metadata", config)
    if data is None or not isinstance(data, dict):
        raise RuntimeError("Unable to fetch group metadata. Check group and token permissions")
    return data


async def get_all_projects(
    session: aiohttp.ClientSession,
    config: GitlabConfig,
    root_full_path: str,
) -> list[dict]:
    base_url = f"{config.url}/api/{GITLAB_API_VERSION}/groups"
    projects: list[dict] = []
    to_visit: deque[dict[str, str]] = deque([{"id": config.group, "full_path": root_full_path}])

    while to_visit:
        current = to_visit.popleft()
        group_id = current["id"]
        group_path = current["full_path"]
        logger.info("Fetching projects for group %s (%s)", group_path, group_id)

        project_items = await fetch_paginated(
            session,
            f"{base_url}/{group_id}/projects",
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
            f"{base_url}/{group_id}/subgroups",
            {},
            f"subgroups for group {group_path}",
            config,
        )

        for subgroup in subgroups:
            subgroup_id = str(subgroup["id"])
            subgroup_path = subgroup.get("full_path") or subgroup.get("path") or subgroup_id
            to_visit.append({"id": subgroup_id, "full_path": subgroup_path})

    return projects


def build_clone_target(project: dict, config: GitlabConfig) -> tuple[str, str]:
    repo_name = sanitize_path_component(project.get("name", "unknown-repo")) or "unknown-repo"
    group_path = sanitize_path_component(project.get("group_path", ""))
    parts = [config.clone_path] + ([*group_path.split("/")] if group_path else []) + [repo_name]
    target_path = os.path.join(*parts)
    return repo_name, target_path


async def run_git_command(*args: str, env: dict[str, str] | None = None) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    stdout, stderr = await process.communicate()
    return (
        process.returncode,
        stdout.decode(errors="ignore").strip(),
        stderr.decode(errors="ignore").strip(),
    )


async def clone_repository(
    project: dict,
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

            logger.info("Updating %s with git pull --ff-only", repo_name)
            code, _, stderr = await run_git_command(
                "git",
                "-C",
                full_clone_path,
                "pull",
                "--ff-only",
            )
            if code == 0:
                return CloneResult(name=repo_name, status="updated", message="Updated successfully")
            return CloneResult(
                name=repo_name,
                status="failed",
                message=f"Update failed: {stderr[:200]}",
            )

        try:
            clone_url = build_authenticated_clone_url(https_url, config.token)
        except ValueError as exc:
            logger.error("Skipping %s: %s", repo_name, exc)
            return CloneResult(name=repo_name, status="failed", message=str(exc))

        logger.info("Cloning %s into %s", repo_name, full_clone_path)

        total_attempts = config.clone_retries + 1
        delay = 1
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
                delay = min(delay * 2, CLONE_RETRY_BACKOFF_MAX)

        return CloneResult(
            name=repo_name,
            status="failed",
            message=f"Clone failed: {stderr[:200]}",
        )


async def clone_all_repositories(
    projects: list[dict],
    config: GitlabConfig,
    shutdown_event: asyncio.Event,
) -> list[CloneResult]:
    semaphore = asyncio.Semaphore(config.max_concurrency)
    tasks = [clone_repository(project, config, semaphore, shutdown_event) for project in projects]
    return await asyncio.gather(*tasks)


def print_summary(results: list[CloneResult]) -> bool:
    success = sum(1 for item in results if item.status == "success")
    skipped = sum(1 for item in results if item.status == "skipped")
    failed = sum(1 for item in results if item.status == "failed")
    updated = sum(1 for item in results if item.status == "updated")

    logger.info(
        "Summary: success=%s updated=%s skipped=%s failed=%s",
        success,
        updated,
        skipped,
        failed,
    )

    if failed:
        logger.error("Failed repositories:")
        for item in results:
            if item.status == "failed":
                logger.error("- %s: %s", item.name, item.message)

    return failed > 0


def print_dry_run(projects: list[dict], config: GitlabConfig) -> None:
    logger.info("Dry-run mode enabled. Projects to process: %s", len(projects))
    logger.info("%-8s %-30s %-30s %-45s %s", "ID", "NAME", "GROUP_PATH", "URL", "TARGET")

    for project in projects:
        repo_name, target_path = build_clone_target(project, config)
        url = str(project.get("http_url_to_repo", ""))[:45]
        logger.info(
            "%-8s %-30s %-30s %-45s %s",
            str(project.get("id", "")),
            repo_name[:30],
            project.get("group_path", "")[:30],
            url,
            target_path,
        )


def install_signal_handlers(loop: asyncio.AbstractEventLoop, shutdown_event: asyncio.Event) -> None:
    def set_shutdown() -> None:
        logger.warning("Shutdown signal received. New clone tasks will be skipped")
        shutdown_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, set_shutdown)
        except (NotImplementedError, RuntimeError):
            pass


async def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = parse_args(argv)
    setup_logging(args.log_level, args.log_file)
    config = config_from_args(args)

    Path(config.clone_path).mkdir(parents=True, exist_ok=True)

    headers = {"Authorization": f"Bearer {config.token}"}
    connector = aiohttp.TCPConnector(limit=20, limit_per_host=10)
    shutdown_event = asyncio.Event()
    install_signal_handlers(asyncio.get_running_loop(), shutdown_event)

    try:
        async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
            group_meta = await fetch_group_metadata(session, config)
            root_full_path = group_meta.get("full_path", str(group_meta.get("path", config.group)))
            logger.info("Fetching repository list")
            projects = await get_all_projects(session, config, root_full_path)

        logger.info("Found %s repositories", len(projects))

        if config.dry_run:
            print_dry_run(projects, config)
            return 0

        logger.info("Starting clone")
        results = await clone_all_repositories(projects, config, shutdown_event)
        has_failed = print_summary(results)
        return 1 if has_failed else 0
    except Exception as exc:
        logger.exception("Unhandled error: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
