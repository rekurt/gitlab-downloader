from __future__ import annotations

from dataclasses import dataclass


@dataclass
class GitlabConfig:
    url: str
    token: str | None
    group: str | None
    clone_path: str
    per_page: int
    request_timeout: int
    max_retries: int
    clone_retries: int
    max_concurrency: int
    dry_run: bool
    update_existing: bool
    log_level: str
    log_file: str | None
    interactive: bool
    report_json: str | None
    auth_method: str
    git_auth_mode: str
    oauth_client_id: str | None
    oauth_client_secret: str | None
    oauth_scope: str
    oauth_cache_path: str


@dataclass
class CloneResult:
    name: str
    status: str
    message: str
