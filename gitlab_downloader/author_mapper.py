"""Author and committer mapping management for git migration."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import yaml

from .models import AuthorMapping, CommitterMapping, MigrationConfig

logger = logging.getLogger(__name__)


class AuthorMapper:
    """Handles reading and writing of author/committer mappings to disk."""

    def __init__(self, config_path: str | Path):
        """Initialize AuthorMapper with a config file path.

        Args:
            config_path: Path to JSON or YAML config file
        """
        self.config_path = Path(config_path)

    def load_mappings(self) -> tuple[dict[str, AuthorMapping], dict[str, CommitterMapping]]:
        """Load author and committer mappings from config file.

        Returns:
            Tuple of (author_mappings, committer_mappings) dictionaries

        Raises:
            FileNotFoundError: If config file doesn't exist
            ValueError: If config format is invalid
        """
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config file not found: {self.config_path}")

        file_content = self.config_path.read_text(encoding="utf-8")

        if self.config_path.suffix in {".yaml", ".yml"}:
            data = yaml.safe_load(file_content)
        elif self.config_path.suffix == ".json":
            data = json.loads(file_content)
        else:
            raise ValueError(f"Unsupported file format: {self.config_path.suffix}")

        if not isinstance(data, dict):
            raise ValueError("Config must be a dictionary")

        author_mappings = self._parse_author_mappings(data.get("author_mappings", {}))
        committer_mappings = self._parse_committer_mappings(data.get("committer_mappings", {}))

        return author_mappings, committer_mappings

    def save_mappings(
        self,
        author_mappings: dict[str, AuthorMapping],
        committer_mappings: dict[str, CommitterMapping],
    ) -> None:
        """Save author and committer mappings while preserving migration config.

        If the config file exists, preserves required migration fields.
        If the file doesn't exist, creates it with only the mappings.

        Args:
            author_mappings: Dictionary of author mappings
            committer_mappings: Dictionary of committer mappings

        Raises:
            ValueError: If config format is invalid
        """
        self.config_path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "author_mappings": self._serialize_mappings(author_mappings),
            "committer_mappings": self._serialize_mappings(committer_mappings),
        }

        # If file exists, preserve required migration fields
        if self.config_path.exists():
            file_content = self.config_path.read_text(encoding="utf-8")
            if self.config_path.suffix in {".yaml", ".yml"}:
                existing_data = yaml.safe_load(file_content)
            elif self.config_path.suffix == ".json":
                existing_data = json.loads(file_content)
            else:
                raise ValueError(f"Unsupported file format: {self.config_path.suffix}")

            if not isinstance(existing_data, dict):
                raise ValueError("Config must be a dictionary")

            # Preserve required migration fields if they exist
            required_fields = {"source_repos_path", "target_hosting_url", "target_token"}
            for field in required_fields:
                if field in existing_data:
                    data[field] = existing_data[field]

        if self.config_path.suffix in {".yaml", ".yml"}:
            content = yaml.dump(data, default_flow_style=False)
        elif self.config_path.suffix == ".json":
            content = json.dumps(data, indent=2)
        else:
            raise ValueError(f"Unsupported file format: {self.config_path.suffix}")

        # Write with restricted permissions (0o600) since config may contain tokens
        with os.fdopen(
            os.open(str(self.config_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600),
            "w",
            encoding="utf-8",
        ) as f:
            f.write(content)

        logger.info(f"Mappings saved to {self.config_path}")

    def load_migration_config(self) -> MigrationConfig:
        """Load complete migration configuration from file.

        Returns:
            MigrationConfig instance

        Raises:
            FileNotFoundError: If config file doesn't exist
            ValueError: If config is invalid
        """
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config file not found: {self.config_path}")

        file_content = self.config_path.read_text(encoding="utf-8")

        if self.config_path.suffix in {".yaml", ".yml"}:
            data = yaml.safe_load(file_content)
        elif self.config_path.suffix == ".json":
            data = json.loads(file_content)
        else:
            raise ValueError(f"Unsupported file format: {self.config_path.suffix}")

        if not isinstance(data, dict):
            raise ValueError("Config must be a dictionary")

        required_fields = {
            "source_repos_path",
            "target_hosting_url",
            "target_token",
        }
        missing = required_fields - set(data.keys())
        if missing:
            raise ValueError(f"Missing required config fields: {missing}")

        author_mappings = self._parse_author_mappings(data.get("author_mappings", {}))
        committer_mappings = self._parse_committer_mappings(data.get("committer_mappings", {}))

        return MigrationConfig(
            source_repos_path=data["source_repos_path"],
            target_hosting_url=data["target_hosting_url"],
            target_token=data["target_token"],
            author_mappings=author_mappings,
            committer_mappings=committer_mappings,
        )

    def save_migration_config(self, config: MigrationConfig) -> None:
        """Save complete migration configuration to file.

        Args:
            config: MigrationConfig instance to save
        """
        self.config_path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "source_repos_path": config.source_repos_path,
            "target_hosting_url": config.target_hosting_url,
            "target_token": config.target_token,
            "author_mappings": self._serialize_mappings(config.author_mappings),
            "committer_mappings": self._serialize_mappings(config.committer_mappings),
        }

        if self.config_path.suffix in {".yaml", ".yml"}:
            content = yaml.dump(data, default_flow_style=False)
        elif self.config_path.suffix == ".json":
            content = json.dumps(data, indent=2)
        else:
            raise ValueError(f"Unsupported file format: {self.config_path.suffix}")

        # Write with restricted permissions (0o600) since config contains tokens
        with os.fdopen(
            os.open(str(self.config_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600),
            "w",
            encoding="utf-8",
        ) as f:
            f.write(content)

        logger.info(f"Migration config saved to {self.config_path}")

    @staticmethod
    def _parse_mappings(data: Any, cls: type, label: str) -> dict[str, Any]:
        """Parse mappings from dictionary using the given dataclass type.

        Args:
            data: Raw mapping dictionary from config file
            cls: Dataclass type to instantiate (AuthorMapping or CommitterMapping)
            label: Human-readable label for log messages
        """
        if not isinstance(data, dict):
            return {}

        mappings: dict[str, Any] = {}
        for key, value in data.items():
            if not isinstance(value, dict):
                continue

            try:
                original_name = value.get("original_name", "")
                original_email = value.get("original_email", "")
                new_name = value.get("new_name", "")
                new_email = value.get("new_email", "")

                if not original_name or not original_email:
                    logger.warning(
                        f"Skipping {label} mapping '{key}': "
                        "original_name and original_email are required"
                    )
                    continue

                mapping = cls(
                    original_name=original_name,
                    original_email=original_email,
                    new_name=new_name,
                    new_email=new_email,
                )
                mappings[key] = mapping
            except (KeyError, TypeError):
                logger.warning(f"Invalid {label} mapping for key: {key}")

        return mappings

    @staticmethod
    def _parse_author_mappings(data: Any) -> dict[str, AuthorMapping]:
        """Parse author mappings from dictionary."""
        return AuthorMapper._parse_mappings(data, AuthorMapping, "author")

    @staticmethod
    def _parse_committer_mappings(data: Any) -> dict[str, CommitterMapping]:
        """Parse committer mappings from dictionary."""
        return AuthorMapper._parse_mappings(data, CommitterMapping, "committer")

    @staticmethod
    def _serialize_mappings(
        mappings: dict[str, Any],
    ) -> dict[str, dict[str, str]]:
        """Convert mapping objects to serializable dictionaries."""
        result = {}
        for key, mapping in mappings.items():
            result[key] = {
                "original_name": mapping.original_name,
                "original_email": mapping.original_email,
                "new_name": mapping.new_name,
                "new_email": mapping.new_email,
            }
        return result
