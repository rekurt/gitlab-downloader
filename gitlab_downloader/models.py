from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

CloneStatus = Literal["success", "updated", "skipped", "failed"]


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
    status: CloneStatus
    message: str


@dataclass
class AuthorMapping:
    """Represents mapping from one author to another"""
    original_name: str
    original_email: str
    new_name: str
    new_email: str


@dataclass
class CommitterMapping:
    """Represents mapping from one committer to another"""
    original_name: str
    original_email: str
    new_name: str
    new_email: str


@dataclass
class MigrationConfig:
    """Configuration for git migration task"""
    source_repos_path: str
    target_hosting_url: str
    target_token: str
    author_mappings: dict[str, AuthorMapping]
    committer_mappings: dict[str, CommitterMapping]
