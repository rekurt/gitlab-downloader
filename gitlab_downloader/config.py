from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
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


def get_version() -> str:
    try:
        return version("gitlab-downloader")
    except PackageNotFoundError:
        return "0.0.0-dev"


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def validate_gitlab_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.hostname)


def _cached_oauth_client_id(cache_path: str | None, gitlab_url: str | None) -> str | None:
    if not cache_path or not gitlab_url:
        return None
    try:
        payload = json.loads(Path(cache_path).expanduser().read_text(encoding="utf-8"))
    except Exception:
        return None
    cached_url = str(payload.get("instance_url", "")).rstrip("/")
    if cached_url != gitlab_url.rstrip("/"):
        return None
    client_id = payload.get("client_id")
    if isinstance(client_id, str) and client_id.strip():
        return client_id.strip()
    return None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch and clone all projects from a GitLab group")
    parser.add_argument("--version", action="version", version=f"%(prog)s {get_version()}")
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
    parser.add_argument(
        "--auth-method",
        choices=["token", "oauth"],
        default=os.getenv("AUTH_METHOD", "oauth"),
    )
    parser.add_argument(
        "--git-auth-mode",
        choices=["url", "credential_helper"],
        default=os.getenv("GIT_AUTH_MODE", "url"),
    )
    parser.add_argument("--oauth-client-id", default=os.getenv("GITLAB_OAUTH_CLIENT_ID"))
    parser.add_argument("--oauth-client-secret", default=os.getenv("GITLAB_OAUTH_CLIENT_SECRET"))
    parser.add_argument(
        "--oauth-scope",
        default=os.getenv("GITLAB_OAUTH_SCOPE", "read_api read_repository"),
    )
    parser.add_argument(
        "--oauth-cache-path",
        default=os.getenv(
            "GITLAB_OAUTH_CACHE_PATH",
            str(Path.home() / ".config" / "gitlab-dump" / "oauth_token.json"),
        ),
    )
    parser.add_argument("--dry-run", action="store_true", default=env_bool("DRY_RUN", False))
    parser.add_argument("--update", action="store_true", default=env_bool("UPDATE_EXISTING", False))
    parser.add_argument(
        "--interactive",
        action="store_true",
        default=env_bool("INTERACTIVE", False),
        help="Prompt interactively for missing settings",
    )
    parser.add_argument(
        "--interactive-menu",
        action="store_true",
        default=env_bool("INTERACTIVE_MENU", False),
        help="Launch interactive menu for clone/migrate operations",
    )
    parser.add_argument(
        "--api-server",
        action="store_true",
        default=env_bool("API_SERVER", False),
        help="Launch as REST API server for Electron app",
    )
    parser.add_argument(
        "--api-host",
        default=os.getenv("API_HOST", "127.0.0.1"),
        help="Host for API server",
    )
    parser.add_argument(
        "--api-port",
        type=int,
        default=int(os.getenv("API_PORT", 8000)),
        help="Port for API server",
    )

    args = parser.parse_args(argv)
    raw_argv = list(argv) if argv is not None else sys.argv[1:]
    auth_method_explicit = (
        any(arg == "--auth-method" or arg.startswith("--auth-method=") for arg in raw_argv)
        or os.getenv("AUTH_METHOD") is not None
    )

    if (
        not auth_method_explicit
        and args.auth_method == "oauth"
        and not args.oauth_client_id
        and args.token
    ):
        args.auth_method = "token"

    if args.auth_method == "oauth" and not args.oauth_client_id:
        args.oauth_client_id = _cached_oauth_client_id(args.oauth_cache_path, args.url)
    no_cli_args = len(raw_argv) == 0
    has_auth = bool(args.token) if args.auth_method == "token" else bool(args.oauth_client_id)
    missing_required = not (args.url and has_auth)

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
            getpass.getpass(f"{label}: ").strip()
            if secret
            else input(f"{label}{default_hint}: ").strip()
        )
        if raw:
            return raw
        if current:
            return current
        if allow_empty:
            return ""
        print(f"{label} is required")


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


def _prompt_choice(label: str, current: str, choices: tuple[str, ...]) -> str:
    allowed = "/".join(choices)
    while True:
        raw = input(f"{label} [{allowed}, default={current}]: ").strip().lower()
        if not raw:
            return current
        if raw in choices:
            return raw
        print(f"Expected one of: {allowed}")


def fill_interactive(args: argparse.Namespace) -> argparse.Namespace:
    print("Interactive mode: fill GitLab downloader settings")
    args.url = _prompt_text("GitLab URL", args.url)
    args.auth_method = _prompt_choice("Auth method", args.auth_method, ("token", "oauth"))
    if args.auth_method == "token":
        args.token = _prompt_text("GitLab token", args.token, secret=True)
    else:
        if not args.oauth_client_id:
            apps_url = f"{args.url.rstrip('/')}/-/profile/applications" if args.url else ""
            print("OAuth Device Flow requires a GitLab OAuth Application client_id")
            if apps_url:
                print(f"Open and create app: {apps_url}")
                print("Copy 'Application ID' and paste it as OAuth client id")
                print("If app creation is restricted, ask GitLab admin for client_id")
        args.oauth_client_id = _prompt_text("OAuth client id", args.oauth_client_id)
        args.oauth_client_secret = _prompt_text(
            "OAuth client secret (optional)",
            args.oauth_client_secret,
            allow_empty=True,
        )
        args.oauth_scope = _prompt_text("OAuth scope", args.oauth_scope)
        args.oauth_cache_path = _prompt_text("OAuth cache path", args.oauth_cache_path)
    args.git_auth_mode = _prompt_choice(
        "Git auth mode",
        args.git_auth_mode,
        ("url", "credential_helper"),
    )
    args.group = _prompt_text("Group (id or path, optional)", args.group, allow_empty=True)
    args.clone_path = _prompt_text("Clone path", args.clone_path)
    args.concurrency = _prompt_int(
        "Concurrency", args.concurrency, MIN_CONCURRENCY, MAX_CONCURRENCY
    )
    args.timeout = _prompt_int("Request timeout (sec)", args.timeout, 1)
    args.per_page = _prompt_int("Per page", args.per_page, 1)
    args.api_retries = _prompt_int("API retries", args.api_retries, 1)
    args.clone_retries = _prompt_int("Clone retries", args.clone_retries, 0)
    args.update = _prompt_bool("Update existing repositories", args.update)
    args.dry_run = _prompt_bool("Dry run", args.dry_run)
    return args


def validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    # API server and interactive menu modes do not require GitLab credentials
    if getattr(args, "api_server", False) or getattr(args, "interactive_menu", False):
        return

    missing = []
    if not args.url:
        missing.append("--url / GITLAB_URL")
    if args.auth_method == "token" and not args.token:
        missing.append("--token / GITLAB_TOKEN")
    if args.auth_method == "oauth" and not args.oauth_client_id:
        missing.append("--oauth-client-id / GITLAB_OAUTH_CLIENT_ID")
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

    if args.api_retries < 1:
        parser.error("--api-retries must be >= 1")

    if args.clone_retries < 0:
        parser.error("--clone-retries must be >= 0")


def config_from_args(args: argparse.Namespace) -> GitlabConfig:
    return GitlabConfig(
        url=args.url.rstrip("/"),
        token=args.token or None,
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
        interactive_menu=getattr(args, "interactive_menu", False),
        report_json=getattr(args, "report_json", None),
        auth_method=args.auth_method,
        git_auth_mode=args.git_auth_mode,
        oauth_client_id=args.oauth_client_id,
        oauth_client_secret=args.oauth_client_secret or None,
        oauth_scope=args.oauth_scope,
        oauth_cache_path=args.oauth_cache_path,
        api_server=getattr(args, "api_server", False),
        api_host=getattr(args, "api_host", "127.0.0.1"),
        api_port=getattr(args, "api_port", 8000),
    )
