from __future__ import annotations

import asyncio
import logging
import signal
from dataclasses import replace
from pathlib import Path

from .config import config_from_args, parse_args
from .logging_config import setup_logging

logger = logging.getLogger("gitlab_downloader")


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
    from dotenv import load_dotenv

    load_dotenv()
    args = parse_args(argv)

    from .auth import resolve_access_token
    from .client import fetch_group_metadata, get_all_projects, get_user_projects
    from .cloner import build_clone_target, clone_all_repositories
    from .reporting import print_dry_run, print_summary, write_json_report

    setup_logging(args.log_level, args.log_file)
    config = config_from_args(args)
    access_token = await resolve_access_token(config)
    config = replace(config, token=access_token)

    Path(config.clone_path).mkdir(parents=True, exist_ok=True)

    headers = {"Authorization": f"Bearer {config.token}"}
    import aiohttp

    connector_limit = max(config.max_concurrency * 2, 20)
    connector = aiohttp.TCPConnector(limit=connector_limit, limit_per_host=config.max_concurrency)
    shutdown_event = asyncio.Event()
    install_signal_handlers(asyncio.get_running_loop(), shutdown_event)

    try:
        async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
            logger.info("Fetching repository list")
            if config.group:
                group_meta = await fetch_group_metadata(session, config)
                root_full_path = group_meta.get(
                    "full_path",
                    str(group_meta.get("path", config.group)),
                )
                projects = await get_all_projects(session, config, root_full_path)
            else:
                projects = await get_user_projects(session, config)

        logger.info("Found %s repositories", len(projects))

        if config.dry_run:
            print_dry_run(projects, config, build_clone_target)
            return 0

        logger.info("Starting clone")
        results = await clone_all_repositories(projects, config, shutdown_event)
        has_failed = print_summary(results)

        if config.report_json:
            write_json_report(config.report_json, config, len(projects), results)

        return 1 if has_failed else 0
    except Exception as exc:
        logger.exception("Unhandled error: %s", exc)
        return 1


def run() -> int:
    try:
        return asyncio.run(main())
    except (KeyboardInterrupt, EOFError):
        print("\nInterrupted by user")
        return 130
