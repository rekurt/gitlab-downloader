from __future__ import annotations

import argparse
import os
import sys
from urllib.parse import urlparse

from .constants import (
    DEFAULT_API_RETRIES,
    DEFAULT_CLONE_PATH,
    DEFAULT_CLONE_RETRIES,
    DEFAULT_CONCURRENCY,
    DEFAULT_PER_PAGE,
    DEFAULT_TIMEOUT,
    MAX_CONCURRENCY,
    MIN_CONCURRENCY,
)
from .models import GitlabConfig


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


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
        default=int(os.getenv("MAX_CONCURRENCY", DEFAULT_CONCURRENCY)),
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=int(os.getenv("REQUEST_TIMEOUT", DEFAULT_TIMEOUT)),
    )
    parser.add_argument(
        "--per-page",
        type=int,
        default=int(os.getenv("PER_PAGE", DEFAULT_PER_PAGE)),
    )
    parser.add_argument(
        "--api-retries",
        type=int,
        default=int(os.getenv("MAX_RETRIES", DEFAULT_API_RETRIES)),
    )
    parser.add_argument(
        "--clone-retries",
        type=int,
        default=int(os.getenv("CLONE_RETRIES", DEFAULT_CLONE_RETRIES)),
    )
    parser.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "INFO"))
    parser.add_argument("--log-file", default=os.getenv("LOG_FILE"))
    parser.add_argument("--report-json", default=os.getenv("REPORT_JSON"))
    parser.add_argument("--dry-run", action="store_true", default=env_bool("DRY_RUN", False))
    parser.add_argument("--update", action="store_true", default=env_bool("UPDATE_EXISTING", False))
    parser.add_argument(
        "--interactive",
        action="store_true",
        default=env_bool("INTERACTIVE", False),
        help="Prompt interactively for missing settings",
    )

    args = parser.parse_args(argv)
    raw_argv = list(argv) if argv is not None else sys.argv[1:]
    no_cli_args = len(raw_argv) == 0
    missing_required = not (args.url and args.token)

    if args.interactive or (no_cli_args and missing_required):
        args = fill_interactive(args)

    validate_args(parser, args)
    return args


def _prompt_text(
    label: str,
    current: str | None,
    secret: bool = False,
    allow_empty: bool = False,
) -> str:
    default_hint = f" [{current}]" if current else ""
    while True:
        raw = (
            input(f"{label}{default_hint}: ").strip() if not secret else input(f"{label}: ").strip()
        )
        if raw:
            return raw
        if current:
            return current
        if allow_empty:
            return ""


def _prompt_int(
    label: str, current: int, min_value: int | None = None, max_value: int | None = None
) -> int:
    while True:
        raw = input(f"{label} [{current}]: ").strip()
        if not raw:
            return current
        try:
            value = int(raw)
        except ValueError:
            print("Expected integer value")
            continue
        if min_value is not None and value < min_value:
            print(f"Value must be >= {min_value}")
            continue
        if max_value is not None and value > max_value:
            print(f"Value must be <= {max_value}")
            continue
        return value


def _prompt_bool(label: str, current: bool) -> bool:
    default_value = "y" if current else "n"
    while True:
        raw = input(f"{label} [y/n, default={default_value}]: ").strip().lower()
        if not raw:
            return current
        if raw in {"y", "yes", "1", "true"}:
            return True
        if raw in {"n", "no", "0", "false"}:
            return False
        print("Expected y or n")


def fill_interactive(args: argparse.Namespace) -> argparse.Namespace:
    print("Interactive mode: fill GitLab downloader settings")
    args.url = _prompt_text("GitLab URL", args.url)
    args.token = _prompt_text("GitLab token", args.token, secret=True)
    args.group = _prompt_text("Group (id or path, optional)", args.group, allow_empty=True)
    args.clone_path = _prompt_text("Clone path", args.clone_path)
    args.concurrency = _prompt_int(
        "Concurrency", args.concurrency, MIN_CONCURRENCY, MAX_CONCURRENCY
    )
    args.timeout = _prompt_int("Request timeout (sec)", args.timeout, 1)
    args.per_page = _prompt_int("Per page", args.per_page, 1)
    args.api_retries = _prompt_int("API retries", args.api_retries, 0)
    args.clone_retries = _prompt_int("Clone retries", args.clone_retries, 0)
    args.update = _prompt_bool("Update existing repositories", args.update)
    args.dry_run = _prompt_bool("Dry run", args.dry_run)
    return args


def validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    missing = []
    if not args.url:
        missing.append("--url / GITLAB_URL")
    if not args.token:
        missing.append("--token / GITLAB_TOKEN")
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


def config_from_args(args: argparse.Namespace) -> GitlabConfig:
    return GitlabConfig(
        url=args.url.rstrip("/"),
        token=args.token,
        group=args.group or None,
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
        interactive=getattr(args, "interactive", False),
        report_json=getattr(args, "report_json", None),
    )
