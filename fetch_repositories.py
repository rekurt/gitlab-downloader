from __future__ import annotations

from gitlab_downloader.app import run
from gitlab_downloader.client import fetch_json, fetch_paginated, maybe_rate_limit_delay
from gitlab_downloader.cloner import build_clone_target
from gitlab_downloader.config import config_from_args, parse_args
from gitlab_downloader.models import CloneResult, GitlabConfig
from gitlab_downloader.reporting import print_summary
from gitlab_downloader.utils import (
    build_authenticated_clone_url,
    extract_group_path,
    sanitize_path_component,
    trim_prefix,
)

__all__ = [
    "GitlabConfig",
    "CloneResult",
    "parse_args",
    "config_from_args",
    "trim_prefix",
    "sanitize_path_component",
    "extract_group_path",
    "build_authenticated_clone_url",
    "maybe_rate_limit_delay",
    "fetch_json",
    "fetch_paginated",
    "build_clone_target",
    "print_summary",
    "run",
]

if __name__ == "__main__":
    raise SystemExit(run())
