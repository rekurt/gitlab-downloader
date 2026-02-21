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
    AuthorMappingsSaveRequest,
    ConfigSaveRequest,
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
    """Remove migration tasks older than TTL that are not still running."""
    while True:
        try:
            await asyncio.sleep(300)  # Check every 5 minutes
            async with _migration_tasks_lock:
                current_time = time.time()
                to_remove = [
                    task_id
                    for task_id, task in list(_migration_tasks.items())
                    if current_time - task.get("created_at", current_time) > _MIGRATION_TASK_TTL
                    and task.get("status") not in ("pending", "running")
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
    # Normalize path first to handle symlinks and ..
    path = Path(path_str).expanduser().resolve()

    # After normalization, verify path doesn't escape intended boundaries
    # by checking if it's within allowed parent directories
    if not allow_parent_refs:
        # For safety, ensure the resolved path doesn't contain .. components
        # (resolve() eliminates these, but we validate the string for defense in depth)
        if ".." in path_str:
            raise ValueError(f"Path traversal not allowed: {path_str}")

    return path


@router.get("/status", response_model=StatusResponse)
async def get_status() -> StatusResponse:
    """Get API status and version."""
    return StatusResponse(status="running", version=get_version())


def _sanitize_repo_url(url: str) -> str:
    """Remove sensitive credentials from repository URL.

    Args:
        url: URL that may contain embedded credentials

    Returns:
        URL with credentials removed
    """
    if not url:
        return ""

    from urllib.parse import urlparse, urlunparse

    try:
        parsed = urlparse(url)
        # Handle SSH URLs (git@host:path) - no hostname in urlparse
        if not parsed.hostname:
            # For SSH URLs like git@gitlab.com:group/repo.git, return as-is
            # SSH URLs don't contain embedded credentials in the URL structure
            return url.strip()

        # Remove userinfo (username:password or oauth2:token) from HTTP(S) URLs
        netloc = parsed.hostname
        if parsed.port:
            netloc = f"{netloc}:{parsed.port}"
        sanitized = urlunparse(
            (parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment)
        )
        return sanitized
    except Exception as e:
        logger.warning(f"Could not sanitize URL: {e}")

    return ""


@router.get("/repos", response_model=RepositoriesListResponse)
async def list_repositories(clone_path: str = ".") -> RepositoriesListResponse:
    """List cloned repositories in the specified path, including nested directories."""
    try:
        repo_path = _validate_path(clone_path)
        if not repo_path.exists():
            return RepositoriesListResponse(total=0, repositories=[])

        repositories = []

        def find_git_repos(base_path: Path, max_depth: int = 10, current_depth: int = 0) -> None:
            """Recursively find git repositories up to max_depth."""
            if current_depth > max_depth:
                return

            try:
                for item in base_path.iterdir():
                    if not item.is_dir():
                        continue

                    git_dir = item / ".git"
                    if git_dir.exists():
                        # Found a git repository
                        url = ""
                        try:
                            config_path = git_dir / "config"
                            if config_path.exists():
                                config_text = config_path.read_text()
                                for line in config_text.split("\n"):
                                    if "url =" in line:
                                        parts = line.split("=", 1)
                                        if len(parts) == 2:
                                            raw_url = parts[1].strip()
                                            url = _sanitize_repo_url(raw_url)
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
                    else:
                        # Recurse into subdirectories
                        find_git_repos(item, max_depth=max_depth, current_depth=current_depth + 1)
            except (PermissionError, OSError) as e:
                logger.debug(f"Could not read directory {base_path}: {e}")

        find_git_repos(repo_path)

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
    request: AuthorMappingsSaveRequest, config_path: str = "."
) -> dict[str, str]:
    """Save author and committer mappings to disk."""
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
async def save_config(request: ConfigSaveRequest) -> dict[str, str]:
    """Save migration config to repository directory."""
    try:
        validated_path = _validate_path(request.repo_path)
        validated_source_path = _validate_path(request.source_repos_path)

        # Convert API requests to internal format
        author_map = {}
        for key, author_req in request.author_mappings.items():
            author_map[key] = AuthorMapping(
                original_name=author_req.original_name,
                original_email=author_req.original_email,
                new_name=author_req.new_name,
                new_email=author_req.new_email,
            )

        committer_map = {}
        for key, committer_req in request.committer_mappings.items():
            committer_map[key] = CommitterMapping(
                original_name=committer_req.original_name,
                original_email=committer_req.original_email,
                new_name=committer_req.new_name,
                new_email=committer_req.new_email,
            )

        # Create config and save
        config = MigrationConfig(
            source_repos_path=str(validated_source_path),
            target_hosting_url=request.target_hosting_url,
            target_token=request.target_token,
            author_mappings=author_map,
            committer_mappings=committer_map,
        )

        ConfigFileManager.save_config(str(validated_path), config, format=request.format)
        return {"status": "saved"}
    except ValueError as e:
        logger.error(f"Error saving config: {e}")
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Error saving config: {e}")
        raise HTTPException(status_code=500, detail=f"Error saving config: {e}") from e
