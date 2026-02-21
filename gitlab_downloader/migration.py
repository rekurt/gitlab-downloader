"""Git migration utilities for author/committer replacement and repo migration."""

from __future__ import annotations

import logging
import subprocess
from collections.abc import Callable
from pathlib import Path

from .models import AuthorMapping, CommitterMapping, MigrationConfig

logger = logging.getLogger(__name__)


class MigrationExecutor:
    """Executes git migrations including author/committer replacement."""

    def __init__(self, config: MigrationConfig):
        """Initialize MigrationExecutor with migration config.

        Args:
            config: MigrationConfig instance with migration settings
        """
        self.config = config
        self.source_repos_path = Path(config.source_repos_path)

    def replace_authors(
        self,
        repo_path: str | Path,
        author_mappings: dict[str, AuthorMapping] | None = None,
        progress_callback: Callable[[str], None] | None = None,
    ) -> bool:
        """Replace authors in git history using git filter-branch.

        Args:
            repo_path: Path to the git repository
            author_mappings: Dictionary of author mappings. If None, uses config mappings
            progress_callback: Optional callback for progress updates

        Returns:
            True if replacement succeeded, False otherwise
        """
        if author_mappings is None:
            author_mappings = self.config.author_mappings

        if not author_mappings:
            logger.info("No author mappings provided, skipping author replacement")
            return True

        repo_path = Path(repo_path)
        if not (repo_path / ".git").exists():
            logger.error(f"Not a git repository: {repo_path}")
            return False

        try:
            if progress_callback:
                progress_callback(f"Starting author replacement in {repo_path}")

            # Create environment variables for git filter-branch
            mapping_script = self._create_author_mapping_script(author_mappings)

            # Use git filter-branch to replace authors
            cmd = [
                "git",
                "filter-branch",
                "-f",
                "--env-filter",
                mapping_script,
                "--",
                "--all",
            ]

            result = subprocess.run(
                cmd,
                cwd=str(repo_path),
                capture_output=True,
                text=True,
                timeout=3600,
            )

            if result.returncode != 0:
                logger.error(
                    f"Author replacement failed in {repo_path}: {result.stderr}"
                )
                return False

            if progress_callback:
                progress_callback(f"Author replacement completed for {repo_path}")

            logger.info(f"Author replacement completed for {repo_path}")
            return True

        except subprocess.TimeoutExpired:
            logger.error(f"Author replacement timed out for {repo_path}")
            return False
        except Exception as e:
            logger.error(f"Error during author replacement in {repo_path}: {e}")
            return False

    def replace_committers(
        self,
        repo_path: str | Path,
        committer_mappings: dict[str, CommitterMapping] | None = None,
        progress_callback: Callable[[str], None] | None = None,
    ) -> bool:
        """Replace committers in git history using git filter-branch.

        Args:
            repo_path: Path to the git repository
            committer_mappings: Dictionary of committer mappings. If None, uses config mappings
            progress_callback: Optional callback for progress updates

        Returns:
            True if replacement succeeded, False otherwise
        """
        if committer_mappings is None:
            committer_mappings = self.config.committer_mappings

        if not committer_mappings:
            logger.info("No committer mappings provided, skipping committer replacement")
            return True

        repo_path = Path(repo_path)
        if not (repo_path / ".git").exists():
            logger.error(f"Not a git repository: {repo_path}")
            return False

        try:
            if progress_callback:
                progress_callback(f"Starting committer replacement in {repo_path}")

            # Create environment variables for git filter-branch
            mapping_script = self._create_committer_mapping_script(committer_mappings)

            # Use git filter-branch to replace committers
            cmd = [
                "git",
                "filter-branch",
                "-f",
                "--env-filter",
                mapping_script,
                "--",
                "--all",
            ]

            result = subprocess.run(
                cmd,
                cwd=str(repo_path),
                capture_output=True,
                text=True,
                timeout=3600,
            )

            if result.returncode != 0:
                logger.error(
                    f"Committer replacement failed in {repo_path}: {result.stderr}"
                )
                return False

            if progress_callback:
                progress_callback(f"Committer replacement completed for {repo_path}")

            logger.info(f"Committer replacement completed for {repo_path}")
            return True

        except subprocess.TimeoutExpired:
            logger.error(f"Committer replacement timed out for {repo_path}")
            return False
        except Exception as e:
            logger.error(f"Error during committer replacement in {repo_path}: {e}")
            return False

    def migrate_repository(
        self,
        repo_path: str | Path,
        author_mappings: dict[str, AuthorMapping] | None = None,
        committer_mappings: dict[str, CommitterMapping] | None = None,
        progress_callback: Callable[[str], None] | None = None,
    ) -> bool:
        """Execute complete migration for a repository (authors + committers).

        Args:
            repo_path: Path to the git repository
            author_mappings: Dictionary of author mappings. If None, uses config mappings
            committer_mappings: Dictionary of committer mappings. If None, uses config mappings
            progress_callback: Optional callback for progress updates

        Returns:
            True if migration succeeded, False otherwise
        """
        repo_path = Path(repo_path)

        if not (repo_path / ".git").exists():
            logger.error(f"Not a git repository: {repo_path}")
            return False

        if progress_callback:
            progress_callback(f"Starting migration for {repo_path.name}")

        # Replace authors first
        if not self.replace_authors(repo_path, author_mappings, progress_callback):
            return False

        # Then replace committers
        if not self.replace_committers(
            repo_path, committer_mappings, progress_callback
        ):
            return False

        if progress_callback:
            progress_callback(f"Migration completed for {repo_path.name}")

        return True

    @staticmethod
    def _create_author_mapping_script(
        mappings: dict[str, AuthorMapping],
    ) -> str:
        """Create bash script for git filter-branch author replacement.

        Args:
            mappings: Dictionary of author mappings

        Returns:
            Bash script as string
        """
        conditions = []
        for mapping in mappings.values():
            conditions.append(
                f'[ "$GIT_AUTHOR_EMAIL" = "{mapping.original_email}" ] && '
                f'export GIT_AUTHOR_NAME="{mapping.new_name}" && '
                f'export GIT_AUTHOR_EMAIL="{mapping.new_email}"'
            )

        script = " || ".join(conditions) if conditions else "true"
        return script

    @staticmethod
    def _create_committer_mapping_script(
        mappings: dict[str, CommitterMapping],
    ) -> str:
        """Create bash script for git filter-branch committer replacement.

        Args:
            mappings: Dictionary of committer mappings

        Returns:
            Bash script as string
        """
        conditions = []
        for mapping in mappings.values():
            conditions.append(
                f'[ "$GIT_COMMITTER_EMAIL" = "{mapping.original_email}" ] && '
                f'export GIT_COMMITTER_NAME="{mapping.new_name}" && '
                f'export GIT_COMMITTER_EMAIL="{mapping.new_email}"'
            )

        script = " || ".join(conditions) if conditions else "true"
        return script
