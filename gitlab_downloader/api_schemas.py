"""Pydantic schemas for API endpoints."""

from __future__ import annotations

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
    repositories: list[RepositoryInfo] = Field(
        ..., description="List of repository information"
    )


class AuthorMappingRequest(BaseModel):
    """Request model for author mapping."""

    original_name: str = Field(..., description="Original author name")
    original_email: str = Field(..., description="Original author email")
    new_name: str = Field(..., description="New author name")
    new_email: str = Field(..., description="New author email")


class CommitterMappingRequest(BaseModel):
    """Request model for committer mapping."""

    original_name: str = Field(..., description="Original committer name")
    original_email: str = Field(..., description="Original committer email")
    new_name: str = Field(..., description="New committer name")
    new_email: str = Field(..., description="New committer email")


class MigrationStartRequest(BaseModel):
    """Request to start a migration."""

    repo_path: str = Field(..., description="Path to repository to migrate")
    author_mappings: dict[str, AuthorMappingRequest] = Field(
        default_factory=dict, description="Author mappings to apply"
    )
    committer_mappings: dict[str, CommitterMappingRequest] = Field(
        default_factory=dict, description="Committer mappings to apply"
    )


class MigrationProgressResponse(BaseModel):
    """Response for migration progress endpoint."""

    migration_id: str = Field(..., description="Unique migration identifier")
    status: str = Field(
        ..., description="Migration status: pending, running, completed, failed"
    )
    progress: int = Field(..., description="Progress percentage (0-100)")
    current_task: str | None = Field(None, description="Current task being executed")
    messages: list[str] = Field(default_factory=list, description="Progress messages")
    error: str | None = Field(None, description="Error message if migration failed")


class ErrorResponse(BaseModel):
    """Standard error response."""

    error: str = Field(..., description="Error message")
    detail: str | None = Field(None, description="Additional error details")
