"""API routes for Electron frontend communication."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from .api_schemas import (
    AuthorMappingRequest,
    CommitterMappingRequest,
    MigrationProgressResponse,
    MigrationStartRequest,
    RepositoriesListResponse,
    RepositoryInfo,
    StatusResponse,
)
from .author_mapper import AuthorMapper
from .config import get_version
from .migration import ConfigFileManager, MigrationExecutor
from .models import (
    AuthorMapping,
    CommitterMapping,
    MigrationConfig,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["api"])

# In-memory storage for migration progress
_migration_tasks: dict[str, dict[str, Any]] = {}
_migration_tasks_lock = asyncio.Lock()
_MIGRATION_TASK_TTL = 3600  # Clean up tasks older than 1 hour


async def _cleanup_old_migrations() -> None:
    """Remove migration tasks older than TTL."""
    while True:
        try:
            await asyncio.sleep(300)  # Check every 5 minutes
            async with _migration_tasks_lock:
                current_time = time.time()
                to_remove = [
                    task_id
                    for task_id, task in list(_migration_tasks.items())
                    if current_time - task.get("created_at", current_time) > _MIGRATION_TASK_TTL
                ]
                for task_id in to_remove:
                    logger.info(f"Cleaning up old migration task {task_id}")
                    del _migration_tasks[task_id]
        except asyncio.CancelledError:
            break
        except Exception as e:  # pylint: disable=broad-except
            logger.error(f"Error during migration cleanup: {e}")


def _validate_path(path_str: str, allow_parent_refs: bool = False) -> Path:
    """Validate and normalize a path to prevent directory traversal attacks.

    Args:
        path_str: Path string from user input
        allow_parent_refs: Whether to allow .. in paths (should be False for user input)

    Returns:
        Validated Path object

    Raises:
        ValueError: If path contains invalid traversal patterns
    """
    path = Path(path_str).resolve()

    # Reject paths containing .. unless explicitly allowed
    if not allow_parent_refs and ".." in path_str:
        raise ValueError(f"Path traversal not allowed: {path_str}")

    return path


@router.get("/status", response_model=StatusResponse)
async def get_status() -> StatusResponse:
    """Get API status and version."""
    return StatusResponse(status="running", version=get_version())


@router.get("/repos", response_model=RepositoriesListResponse)
async def list_repositories(clone_path: str = ".") -> RepositoriesListResponse:
    """List cloned repositories in the specified path."""
    try:
        repo_path = _validate_path(clone_path)
        if not repo_path.exists():
            return RepositoriesListResponse(total=0, repositories=[])

        repositories = []
        for item in repo_path.iterdir():
            if not item.is_dir():
                continue

            git_dir = item / ".git"
            if not git_dir.exists():
                continue

            # Try to read git config to get the remote URL
            url = ""
            try:
                config_path = git_dir / "config"
                if config_path.exists():
                    config_text = config_path.read_text()
                    for line in config_text.split("\n"):
                        if "url =" in line:
                            parts = line.split("=", 1)
                            if len(parts) == 2:
                                url = parts[1].strip()
                                break
            except Exception as e:
                logger.warning(f"Could not read git config for {item.name}: {e}")

            repo_info = RepositoryInfo(
                name=item.name,
                path=str(item.absolute()),
                url=url,
                last_updated=None,
            )
            repositories.append(repo_info)

        return RepositoriesListResponse(total=len(repositories), repositories=repositories)

    except Exception as e:
        logger.error(f"Error listing repositories: {e}")
        raise HTTPException(status_code=500, detail=f"Error listing repositories: {e}") from e


@router.get("/author-mappings")
async def get_author_mappings(config_path: str = ".") -> dict[str, AuthorMappingRequest]:
    """Get saved author mappings from disk."""
    try:
        validated_path = _validate_path(config_path)
        config_file = validated_path / "migration_config.json"
        if not config_file.exists():
            config_file = validated_path / "migration_config.yaml"

        if not config_file.exists():
            return {}

        mapper = AuthorMapper(str(config_file))
        author_mappings, _ = mapper.load_mappings()

        # Convert to API response format
        result = {}
        for key, mapping in author_mappings.items():
            result[key] = AuthorMappingRequest(
                original_name=mapping.original_name,
                original_email=mapping.original_email,
                new_name=mapping.new_name,
                new_email=mapping.new_email,
            )
        return result
    except ValueError as e:
        logger.error(f"Error reading author mappings: {e}")
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Error reading author mappings: {e}")
        raise HTTPException(status_code=500, detail=f"Error reading author mappings: {e}") from e


@router.post("/author-mappings")
async def save_author_mappings(
    mappings: dict[str, AuthorMappingRequest], config_path: str = "."
) -> dict[str, str]:
    """Save author mappings to disk."""
    try:
        validated_path = _validate_path(config_path)
        config_file = validated_path / "migration_config.json"

        mapper = AuthorMapper(str(config_file))

        # Convert from API format to internal format
        author_mappings = {
            key: AuthorMapping(
                original_name=req.original_name,
                original_email=req.original_email,
                new_name=req.new_name,
                new_email=req.new_email,
            )
            for key, req in mappings.items()
        }

        # Load existing committer mappings or create empty ones
        committer_mappings: dict[str, CommitterMapping] = {}
        try:
            _, committer_mappings = mapper.load_mappings()
        except FileNotFoundError:
            pass

        mapper.save_mappings(author_mappings, committer_mappings)
        return {"status": "saved"}
    except ValueError as e:
        logger.error(f"Error saving author mappings: {e}")
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Error saving author mappings: {e}")
        raise HTTPException(status_code=500, detail=f"Error saving mappings: {e}") from e


@router.post("/migrate")
async def start_migration(request: MigrationStartRequest) -> dict[str, str]:
    """Start a migration task for a repository."""
    try:
        # Validate repo path
        _validate_path(request.repo_path)

        migration_id = str(uuid.uuid4())

        # Convert request to internal format
        author_mappings = {
            key: AuthorMapping(
                original_name=req.original_name,
                original_email=req.original_email,
                new_name=req.new_name,
                new_email=req.new_email,
            )
            for key, req in request.author_mappings.items()
        }

        committer_mappings = {
            key: CommitterMapping(
                original_name=req.original_name,
                original_email=req.original_email,
                new_name=req.new_name,
                new_email=req.new_email,
            )
            for key, req in request.committer_mappings.items()
        }

        # Store task info (thread-safe)
        async with _migration_tasks_lock:
            _migration_tasks[migration_id] = {
                "status": "pending",
                "progress": 0,
                "current_task": None,
                "messages": [],
                "error": None,
                "created_at": time.time(),
            }

        # Start migration in background
        asyncio.create_task(
            _run_migration(
                migration_id,
                request.repo_path,
                author_mappings,
                committer_mappings,
            )
        )

        return {"migration_id": migration_id}
    except Exception as e:
        logger.error(f"Error starting migration: {e}")
        raise HTTPException(status_code=500, detail=f"Error starting migration: {e}") from e


async def _run_migration(
    migration_id: str,
    repo_path: str,
    author_mappings: dict[str, AuthorMapping],
    committer_mappings: dict[str, CommitterMapping],
) -> None:
    """Run migration task in background."""
    task_info: dict[str, Any] | None = None
    try:
        async with _migration_tasks_lock:
            task_info = _migration_tasks.get(migration_id)
            if not task_info:
                logger.error(f"Migration task {migration_id} not found")
                return
            task_info["status"] = "running"
            task_info["progress"] = 25

        # Closure to safely update progress in thread
        updates_queue: list[str] = []

        def progress_callback(msg: str) -> None:
            if task_info:
                updates_queue.append(msg)

        # Create migration config
        config = MigrationConfig(
            source_repos_path=repo_path,
            target_hosting_url="",
            target_token="",
            author_mappings=author_mappings,
            committer_mappings=committer_mappings,
        )

        executor = MigrationExecutor(config)

        # Update progress with lock protection
        async with _migration_tasks_lock:
            if task_info:
                task_info["progress"] = 50

        # Run migration in thread pool to avoid blocking event loop
        success = await asyncio.to_thread(
            executor.migrate_repository,
            repo_path,
            author_mappings,
            committer_mappings,
            progress_callback,
        )

        # Process queued updates
        async with _migration_tasks_lock:
            if task_info:
                for msg in updates_queue:
                    task_info["messages"].append(msg)
                if updates_queue:
                    task_info["current_task"] = updates_queue[-1]

                if success:
                    task_info["status"] = "completed"
                    task_info["progress"] = 100
                else:
                    task_info["status"] = "failed"
                    task_info["error"] = "Migration failed"

    except Exception as e:
        logger.error(f"Error during migration {migration_id}: {e}")
        async with _migration_tasks_lock:
            task = _migration_tasks.get(migration_id)
            if task:
                task["status"] = "failed"
                task["error"] = str(e)


@router.get("/migration-progress/{migration_id}", response_model=MigrationProgressResponse)
async def get_migration_progress(migration_id: str) -> MigrationProgressResponse:
    """Get migration progress."""
    async with _migration_tasks_lock:
        if migration_id not in _migration_tasks:
            raise HTTPException(status_code=404, detail="Migration not found")

        task_info = _migration_tasks[migration_id]
        return MigrationProgressResponse(
            migration_id=migration_id,
            status=task_info["status"],
            progress=task_info["progress"],
            current_task=task_info["current_task"],
            messages=task_info["messages"],
            error=task_info["error"],
        )


@router.get("/config")
async def get_config(repo_path: str) -> dict[str, Any]:
    """Get migration config from repository directory."""
    try:
        validated_path = _validate_path(repo_path)
        config = ConfigFileManager.load_config(str(validated_path))
        if not config:
            return {"found": False, "config": None}

        return {
            "found": True,
            "config": {
                "source_repos_path": config.source_repos_path,
                "target_hosting_url": config.target_hosting_url,
                # NOTE: target_token is never returned for security reasons
                "author_mappings": {
                    key: {
                        "original_name": mapping.original_name,
                        "original_email": mapping.original_email,
                        "new_name": mapping.new_name,
                        "new_email": mapping.new_email,
                    }
                    for key, mapping in config.author_mappings.items()
                },
                "committer_mappings": {
                    key: {
                        "original_name": mapping.original_name,
                        "original_email": mapping.original_email,
                        "new_name": mapping.new_name,
                        "new_email": mapping.new_email,
                    }
                    for key, mapping in config.committer_mappings.items()
                },
            },
        }
    except ValueError as e:
        logger.error(f"Error reading config: {e}")
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Error reading config: {e}")
        raise HTTPException(status_code=500, detail=f"Error reading config: {e}") from e


@router.post("/config")
async def save_config(
    repo_path: str,
    source_repos_path: str,
    target_hosting_url: str,
    target_token: str,
    author_mappings: dict[str, AuthorMappingRequest] | None = None,
    committer_mappings: dict[str, CommitterMappingRequest] | None = None,
    format: str = "json",
) -> dict[str, str]:
    """Save migration config to repository directory."""
    try:
        validated_path = _validate_path(repo_path)
        validated_source_path = _validate_path(source_repos_path)

        # Convert API requests to internal format
        author_map = {}
        if author_mappings:
            for key, author_req in author_mappings.items():
                author_map[key] = AuthorMapping(
                    original_name=author_req.original_name,
                    original_email=author_req.original_email,
                    new_name=author_req.new_name,
                    new_email=author_req.new_email,
                )

        committer_map = {}
        if committer_mappings:
            for key, committer_req in committer_mappings.items():
                committer_map[key] = CommitterMapping(
                    original_name=committer_req.original_name,
                    original_email=committer_req.original_email,
                    new_name=committer_req.new_name,
                    new_email=committer_req.new_email,
                )

        # Create config and save
        config = MigrationConfig(
            source_repos_path=str(validated_source_path),
            target_hosting_url=target_hosting_url,
            target_token=target_token,
            author_mappings=author_map,
            committer_mappings=committer_map,
        )

        ConfigFileManager.save_config(str(validated_path), config, format=format)
        return {"status": "saved"}
    except ValueError as e:
        logger.error(f"Error saving config: {e}")
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Error saving config: {e}")
        raise HTTPException(status_code=500, detail=f"Error saving config: {e}") from e
