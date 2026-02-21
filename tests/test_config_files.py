"""Tests for config file loading and saving."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest
import yaml

from gitlab_downloader.migration import ConfigFileManager
from gitlab_downloader.models import AuthorMapping, CommitterMapping, MigrationConfig


class TestConfigFileManager:
    """Tests for ConfigFileManager class."""

    def test_save_and_load_json_config(self):
        """Test saving and loading config in JSON format."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)

            # Create a config
            config = MigrationConfig(
                source_repos_path=str(repo_path),
                target_hosting_url="https://github.com/org",
                target_token="token123",
                author_mappings={
                    "author1": AuthorMapping(
                        original_name="John Doe",
                        original_email="john@example.com",
                        new_name="Jane Doe",
                        new_email="jane@example.com",
                    )
                },
                committer_mappings={
                    "committer1": CommitterMapping(
                        original_name="John Smith",
                        original_email="john@example.com",
                        new_name="Jane Smith",
                        new_email="jane@example.com",
                    )
                },
            )

            # Save config
            ConfigFileManager.save_config(repo_path, config, format="json")

            # Verify file exists
            config_file = repo_path / "migration_config.json"
            assert config_file.exists()

            # Load config
            loaded_config = ConfigFileManager.load_config(repo_path)
            assert loaded_config is not None
            assert loaded_config.source_repos_path == str(repo_path)
            assert loaded_config.target_hosting_url == "https://github.com/org"
            assert loaded_config.target_token == "token123"
            assert len(loaded_config.author_mappings) == 1
            assert len(loaded_config.committer_mappings) == 1

    def test_save_and_load_yaml_config(self):
        """Test saving and loading config in YAML format."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)

            # Create a config
            config = MigrationConfig(
                source_repos_path=str(repo_path),
                target_hosting_url="https://gitlab.com/org",
                target_token="token456",
                author_mappings={},
                committer_mappings={},
            )

            # Save config in YAML format
            ConfigFileManager.save_config(repo_path, config, format="yaml")

            # Verify file exists
            config_file = repo_path / "migration_config.yaml"
            assert config_file.exists()

            # Load config
            loaded_config = ConfigFileManager.load_config(repo_path)
            assert loaded_config is not None
            assert loaded_config.target_hosting_url == "https://gitlab.com/org"

    def test_load_nonexistent_config(self):
        """Test loading config when no config file exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            result = ConfigFileManager.load_config(repo_path)
            assert result is None

    def test_load_invalid_json_config(self):
        """Test loading invalid JSON config file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            config_file = repo_path / "migration_config.json"
            config_file.write_text("not valid json {")

            with pytest.raises(ValueError, match="Failed to load config"):
                ConfigFileManager.load_config(repo_path)

    def test_load_non_dict_json_config(self):
        """Test loading JSON config that is not a dictionary."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            config_file = repo_path / "migration_config.json"
            config_file.write_text('["array", "not", "dict"]')

            with pytest.raises(ValueError, match="must be a dictionary"):
                ConfigFileManager.load_config(repo_path)

    def test_validate_config_missing_required_fields(self):
        """Test validation of config with missing required fields."""
        data = {"target_hosting_url": "https://github.com"}

        with pytest.raises(ValueError, match="Missing required field"):
            ConfigFileManager.validate_config(data)

    def test_validate_config_invalid_author_mappings(self):
        """Test validation of config with invalid author mappings."""
        data = {
            "source_repos_path": "/repos",
            "target_hosting_url": "https://github.com",
            "target_token": "token",
            "author_mappings": "not_a_dict",
        }

        with pytest.raises(ValueError, match="author_mappings must be a dictionary"):
            ConfigFileManager.validate_config(data)

    def test_validate_config_missing_author_mapping_field(self):
        """Test validation of config with missing author mapping field."""
        data = {
            "source_repos_path": "/repos",
            "target_hosting_url": "https://github.com",
            "target_token": "token",
            "author_mappings": {
                "author1": {
                    "original_name": "John",
                    "original_email": "john@example.com",
                    # missing new_name and new_email
                }
            },
        }

        with pytest.raises(ValueError, match="author_mappings\\[author1\\] missing field"):
            ConfigFileManager.validate_config(data)

    def test_validate_config_invalid_committer_mappings(self):
        """Test validation of config with invalid committer mappings."""
        data = {
            "source_repos_path": "/repos",
            "target_hosting_url": "https://github.com",
            "target_token": "token",
            "committer_mappings": "not_a_dict",
        }

        with pytest.raises(ValueError, match="committer_mappings must be a dictionary"):
            ConfigFileManager.validate_config(data)

    def test_config_to_dict_conversion(self):
        """Test converting MigrationConfig to dictionary."""
        config = MigrationConfig(
            source_repos_path="/repos",
            target_hosting_url="https://github.com/org",
            target_token="token123",
            author_mappings={
                "author1": AuthorMapping(
                    original_name="John Doe",
                    original_email="john@example.com",
                    new_name="Jane Doe",
                    new_email="jane@example.com",
                )
            },
            committer_mappings={
                "committer1": CommitterMapping(
                    original_name="John Smith",
                    original_email="john@example.com",
                    new_name="Jane Smith",
                    new_email="jane@example.com",
                )
            },
        )

        result = ConfigFileManager._config_to_dict(config)

        assert result["source_repos_path"] == "/repos"
        assert result["target_hosting_url"] == "https://github.com/org"
        assert result["target_token"] == "token123"
        assert "author1" in result["author_mappings"]
        assert result["author_mappings"]["author1"]["original_name"] == "John Doe"
        assert "committer1" in result["committer_mappings"]
        assert result["committer_mappings"]["committer1"]["original_name"] == "John Smith"

    def test_save_config_invalid_format(self):
        """Test saving config with invalid format."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            config = MigrationConfig(
                source_repos_path=str(repo_path),
                target_hosting_url="https://github.com",
                target_token="token",
                author_mappings={},
                committer_mappings={},
            )

            with pytest.raises(ValueError, match="Format must be"):
                ConfigFileManager.save_config(repo_path, config, format="xml")

    def test_multiple_config_formats_preference(self):
        """Test that JSON is preferred over YAML if both exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)

            config = MigrationConfig(
                source_repos_path=str(repo_path),
                target_hosting_url="https://github.com",
                target_token="token",
                author_mappings={},
                committer_mappings={},
            )

            # Save in both formats
            ConfigFileManager.save_config(repo_path, config, format="json")
            ConfigFileManager.save_config(repo_path, config, format="yaml")

            # Load should get JSON (first in CONFIG_FILENAMES)
            loaded = ConfigFileManager.load_config(repo_path)
            assert loaded is not None

            # Verify JSON exists
            json_file = repo_path / "migration_config.json"
            assert json_file.exists()

            # Verify YAML exists
            yaml_file = repo_path / "migration_config.yaml"
            assert yaml_file.exists()

    def test_config_json_serialization_format(self):
        """Test that saved JSON is properly formatted."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            config = MigrationConfig(
                source_repos_path=str(repo_path),
                target_hosting_url="https://github.com",
                target_token="token",
                author_mappings={
                    "author1": AuthorMapping(
                        original_name="John",
                        original_email="john@example.com",
                        new_name="Jane",
                        new_email="jane@example.com",
                    )
                },
                committer_mappings={},
            )

            ConfigFileManager.save_config(repo_path, config, format="json")

            # Read and parse JSON manually
            config_file = repo_path / "migration_config.json"
            content = json.loads(config_file.read_text())

            # Verify structure
            assert "source_repos_path" in content
            assert "author_mappings" in content
            assert "author1" in content["author_mappings"]

    def test_config_yaml_serialization_format(self):
        """Test that saved YAML is properly formatted."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            config = MigrationConfig(
                source_repos_path=str(repo_path),
                target_hosting_url="https://github.com",
                target_token="token",
                author_mappings={},
                committer_mappings={},
            )

            ConfigFileManager.save_config(repo_path, config, format="yaml")

            # Read and parse YAML manually
            config_file = repo_path / "migration_config.yaml"
            content = yaml.safe_load(config_file.read_text())

            # Verify structure
            assert isinstance(content, dict)
            assert content["source_repos_path"] == str(repo_path)

    def test_empty_mappings_preserved(self):
        """Test that empty author and committer mappings are preserved."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            config = MigrationConfig(
                source_repos_path=str(repo_path),
                target_hosting_url="https://github.com",
                target_token="token",
                author_mappings={},
                committer_mappings={},
            )

            ConfigFileManager.save_config(repo_path, config, format="json")
            loaded = ConfigFileManager.load_config(repo_path)

            assert loaded is not None
            assert loaded.author_mappings == {}
            assert loaded.committer_mappings == {}

    def test_complex_mapping_values(self):
        """Test that complex mapping values with special characters are preserved."""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            config = MigrationConfig(
                source_repos_path=str(repo_path),
                target_hosting_url="https://github.com",
                target_token="token",
                author_mappings={
                    "author1": AuthorMapping(
                        original_name="José García",
                        original_email="josé@example.com",
                        new_name="João Silva",
                        new_email="joao@example.com",
                    )
                },
                committer_mappings={},
            )

            ConfigFileManager.save_config(repo_path, config, format="json")
            loaded = ConfigFileManager.load_config(repo_path)

            assert loaded is not None
            mapping = loaded.author_mappings["author1"]
            assert mapping.original_name == "José García"
            assert mapping.original_email == "josé@example.com"
