"""Git migration utilities for author/committer replacement and repo migration."""

from __future__ import annotations

import json
import logging
import os
import subprocess
from collections.abc import Callable
from pathlib import Path

import yaml

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
                logger.error(f"Author replacement failed in {repo_path}: {result.stderr}")
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
                logger.error(f"Committer replacement failed in {repo_path}: {result.stderr}")
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

        if author_mappings is None:
            author_mappings = self.config.author_mappings
        if committer_mappings is None:
            committer_mappings = self.config.committer_mappings

        if not author_mappings and not committer_mappings:
            logger.info("No mappings provided, skipping migration")
            return True

        if progress_callback:
            progress_callback(f"Starting migration for {repo_path.name}")

        # Combine author and committer scripts into a single filter-branch pass
        # to avoid destroying backup refs with a second -f invocation
        author_script = (
            self._create_author_mapping_script(author_mappings)
            if author_mappings
            else "true"
        )
        committer_script = (
            self._create_committer_mapping_script(committer_mappings)
            if committer_mappings
            else "true"
        )
        combined_script = f"{author_script}\n{committer_script}"

        try:
            cmd = [
                "git",
                "filter-branch",
                "-f",
                "--env-filter",
                combined_script,
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
                logger.error(f"Migration failed in {repo_path}: {result.stderr}")
                return False

        except subprocess.TimeoutExpired:
            logger.error(f"Migration timed out for {repo_path}")
            return False
        except Exception as e:
            logger.error(f"Error during migration in {repo_path}: {e}")
            return False

        if progress_callback:
            progress_callback(f"Migration completed for {repo_path.name}")

        return True

    @staticmethod
    def _create_mapping_script(
        mappings: dict[str, AuthorMapping] | dict[str, CommitterMapping],
        env_prefix: str,
    ) -> str:
        """Create bash script for git filter-branch author or committer replacement.

        Args:
            mappings: Dictionary of author or committer mappings
            env_prefix: Git env var prefix, either "AUTHOR" or "COMMITTER"

        Returns:
            Bash script as string
        """
        import shlex

        parts = []
        first = True
        for mapping in mappings.values():
            # Properly escape all values to prevent shell injection
            original_name = shlex.quote(mapping.original_name)
            original_email = shlex.quote(mapping.original_email)
            new_name = shlex.quote(mapping.new_name)
            new_email = shlex.quote(mapping.new_email)

            keyword = "if" if first else "elif"
            parts.append(
                f'{keyword} [ "$GIT_{env_prefix}_NAME" = {original_name} ] && '
                f'[ "$GIT_{env_prefix}_EMAIL" = {original_email} ]; then\n'
                f"  export GIT_{env_prefix}_NAME={new_name}\n"
                f"  export GIT_{env_prefix}_EMAIL={new_email}"
            )
            first = False

        if parts:
            script = "\n".join(parts) + "\nfi"
        else:
            script = "true"
        return script

    @staticmethod
    def _create_author_mapping_script(
        mappings: dict[str, AuthorMapping],
    ) -> str:
        """Create bash script for git filter-branch author replacement."""
        return MigrationExecutor._create_mapping_script(mappings, "AUTHOR")

    @staticmethod
    def _create_committer_mapping_script(
        mappings: dict[str, CommitterMapping],
    ) -> str:
        """Create bash script for git filter-branch committer replacement."""
        return MigrationExecutor._create_mapping_script(mappings, "COMMITTER")


class ConfigFileManager:
    """Manages loading and saving migration configuration from/to files."""

    CONFIG_FILENAMES = ["migration_config.json", "migration_config.yaml", "migration_config.yml"]

    @staticmethod
    def load_config(repo_path: str | Path) -> MigrationConfig | None:
        """Load migration config from repository directory.

        Args:
            repo_path: Path to the repository

        Returns:
            MigrationConfig instance if found, None otherwise

        Raises:
            ValueError: If config file is invalid
        """
        repo_path = Path(repo_path)

        for filename in ConfigFileManager.CONFIG_FILENAMES:
            config_file = repo_path / filename
            if not config_file.exists():
                continue

            try:
                with open(config_file, encoding="utf-8") as f:
                    data = yaml.safe_load(f) if filename.endswith(("yaml", "yml")) else json.load(f)

                if not isinstance(data, dict):
                    raise ValueError(f"Config file must be a dictionary, got {type(data).__name__}")

                return ConfigFileManager._validate_and_create_config(data)
            except (json.JSONDecodeError, yaml.YAMLError, ValueError) as e:
                raise ValueError(f"Failed to load config from {config_file}: {e}") from e

        return None

    @staticmethod
    def save_config(
        repo_path: str | Path, config: MigrationConfig, file_format: str = "json"
    ) -> None:
        """Save migration config to repository directory.

        Args:
            repo_path: Path to the repository
            config: MigrationConfig instance to save
            file_format: File format ('json' or 'yaml')

        Raises:
            ValueError: If format is invalid
        """
        if file_format not in ("json", "yaml"):
            raise ValueError(f"Format must be 'json' or 'yaml', got {file_format}")

        repo_path = Path(repo_path)
        filename = f"migration_config.{file_format}"
        config_file = repo_path / filename

        try:
            data = ConfigFileManager._config_to_dict(config)

            if file_format == "json":
                content = json.dumps(data, indent=2)
            else:
                content = yaml.dump(data, default_flow_style=False)

            # Write with restricted permissions (0o600) since config may contain tokens
            fd = os.open(str(config_file), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            try:
                os.write(fd, content.encode("utf-8"))
            finally:
                os.close(fd)

            logger.info(f"Config saved to {config_file}")
        except Exception as e:
            raise ValueError(f"Failed to save config to {config_file}") from e

    @staticmethod
    def validate_config(data: dict) -> dict:
        """Validate config file schema.

        Args:
            data: Dictionary from config file

        Returns:
            Validated config dictionary

        Raises:
            ValueError: If validation fails
        """
        required_fields = ["source_repos_path", "target_hosting_url", "target_token"]
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        # Validate author mappings structure
        if "author_mappings" in data:
            mappings = data["author_mappings"]
            if not isinstance(mappings, dict):
                raise ValueError("author_mappings must be a dictionary")
            for key, mapping in mappings.items():
                if not isinstance(mapping, dict):
                    raise ValueError(f"author_mappings[{key}] must be a dictionary")
                fields = ["original_name", "original_email", "new_name", "new_email"]
                for field in fields:
                    if field not in mapping:
                        raise ValueError(f"author_mappings[{key}] missing field: {field}")

        # Validate committer mappings structure
        if "committer_mappings" in data:
            mappings = data["committer_mappings"]
            if not isinstance(mappings, dict):
                raise ValueError("committer_mappings must be a dictionary")
            for key, mapping in mappings.items():
                if not isinstance(mapping, dict):
                    raise ValueError(f"committer_mappings[{key}] must be a dictionary")
                fields = ["original_name", "original_email", "new_name", "new_email"]
                for field in fields:
                    if field not in mapping:
                        raise ValueError(f"committer_mappings[{key}] missing field: {field}")

        return data

    @staticmethod
    def _validate_and_create_config(data: dict) -> MigrationConfig:
        """Validate config dict and create MigrationConfig instance.

        Args:
            data: Dictionary from config file

        Returns:
            MigrationConfig instance

        Raises:
            ValueError: If validation fails
        """
        validated = ConfigFileManager.validate_config(data)

        # Parse author mappings
        author_mappings: dict[str, AuthorMapping] = {}
        for key, mapping in validated.get("author_mappings", {}).items():
            author_mappings[key] = AuthorMapping(
                original_name=mapping["original_name"],
                original_email=mapping["original_email"],
                new_name=mapping["new_name"],
                new_email=mapping["new_email"],
            )

        # Parse committer mappings
        committer_mappings: dict[str, CommitterMapping] = {}
        for key, mapping in validated.get("committer_mappings", {}).items():
            committer_mappings[key] = CommitterMapping(
                original_name=mapping["original_name"],
                original_email=mapping["original_email"],
                new_name=mapping["new_name"],
                new_email=mapping["new_email"],
            )

        return MigrationConfig(
            source_repos_path=validated["source_repos_path"],
            target_hosting_url=validated["target_hosting_url"],
            target_token=validated["target_token"],
            author_mappings=author_mappings,
            committer_mappings=committer_mappings,
        )

    @staticmethod
    def _config_to_dict(config: MigrationConfig) -> dict:
        """Convert MigrationConfig to dictionary for serialization.

        Args:
            config: MigrationConfig instance

        Returns:
            Dictionary representation of config
        """
        return {
            "source_repos_path": config.source_repos_path,
            "target_hosting_url": config.target_hosting_url,
            "target_token": config.target_token,
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
        }
