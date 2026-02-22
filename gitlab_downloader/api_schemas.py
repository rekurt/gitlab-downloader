"""Pydantic schemas for API endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class StatusResponse(BaseModel):
    """Response for /api/status endpoint."""

    status: str = Field(..., description="Current API status")
    version: str = Field(..., description="Application version")


class RepositoryInfo(BaseModel):
    """Information about a cloned repository."""

    name: str = Field(..., description="Repository name")
    path: str = Field(..., description="Full path to repository")
    url: str = Field(..., description="Repository URL")
    last_updated: str | None = Field(None, description="ISO timestamp of last update")


class RepositoriesListResponse(BaseModel):
    """Response for /api/repos endpoint."""

    total: int = Field(..., description="Total number of repositories")
    repositories: list[RepositoryInfo] = Field(..., description="List of repository information")


class AuthorMappingRequest(BaseModel):
    """Request model for author mapping."""

    original_name: str = Field(
        ..., min_length=1, max_length=512, description="Original author name"
    )
    original_email: str = Field(
        ..., min_length=1, max_length=512, description="Original author email"
    )
    new_name: str = Field(..., min_length=1, max_length=512, description="New author name")
    new_email: str = Field(..., min_length=1, max_length=512, description="New author email")


class CommitterMappingRequest(BaseModel):
    """Request model for committer mapping."""

    original_name: str = Field(
        ..., min_length=1, max_length=512, description="Original committer name"
    )
    original_email: str = Field(
        ..., min_length=1, max_length=512, description="Original committer email"
    )
    new_name: str = Field(..., min_length=1, max_length=512, description="New committer name")
    new_email: str = Field(..., min_length=1, max_length=512, description="New committer email")


class AuthorMappingsSaveRequest(BaseModel):
    """Request to save author and committer mappings."""

    author_mappings: dict[str, AuthorMappingRequest] = Field(
        default_factory=dict, description="Author mappings to save"
    )
    committer_mappings: dict[str, CommitterMappingRequest] = Field(
        default_factory=dict, description="Committer mappings to save"
    )


class MigrationStartRequest(BaseModel):
    """Request to start a migration."""

    repo_path: str = Field(..., min_length=1, description="Path to repository to migrate")
    author_mappings: dict[str, AuthorMappingRequest] = Field(
        default_factory=dict, description="Author mappings to apply"
    )
    committer_mappings: dict[str, CommitterMappingRequest] = Field(
        default_factory=dict, description="Committer mappings to apply"
    )


class MigrationProgressResponse(BaseModel):
    """Response for migration progress endpoint."""

    migration_id: str = Field(..., description="Unique migration identifier")
    status: str = Field(..., description="Migration status: pending, running, completed, failed")
    progress: int = Field(..., description="Progress percentage (0-100)")
    current_task: str | None = Field(None, description="Current task being executed")
    messages: list[str] = Field(default_factory=list, description="Progress messages")
    error: str | None = Field(None, description="Error message if migration failed")


class SaveResponse(BaseModel):
    """Standard save response."""

    status: Literal["saved"] = Field(..., description="Operation result")


class MigrationStartResponse(BaseModel):
    """Response for migration start endpoint."""

    migration_id: str = Field(..., description="Created migration task identifier")


class ConfigContentResponse(BaseModel):
    """Serialized migration config returned by API."""

    source_repos_path: str = Field(..., description="Path with source repositories")
    target_hosting_url: str = Field(..., description="Destination Git hosting URL")
    author_mappings: dict[str, AuthorMappingRequest] = Field(
        default_factory=dict, description="Author mapping rules"
    )
    committer_mappings: dict[str, CommitterMappingRequest] = Field(
        default_factory=dict, description="Committer mapping rules"
    )


class ConfigSaveRequest(BaseModel):
    """Request to save migration config."""

    repo_path: str = Field(..., description="Repository directory path")
    source_repos_path: str = Field(..., description="Path with source repositories")
    target_hosting_url: str = Field(..., description="Destination Git hosting URL")
    target_token: str = Field(..., min_length=1, description="Token for target Git hosting")
    author_mappings: dict[str, AuthorMappingRequest] = Field(
        default_factory=dict, description="Author mapping rules"
    )
    committer_mappings: dict[str, CommitterMappingRequest] = Field(
        default_factory=dict, description="Committer mapping rules"
    )
    format: Literal["json", "yaml"] = Field(default="json", description="Config file format")


class ConfigGetResponse(BaseModel):
    """Response for config read endpoint."""

    found: bool = Field(..., description="Whether config file exists in repository directory")
    config: ConfigContentResponse | None = Field(
        None, description="Migration configuration content when found=true"
    )
