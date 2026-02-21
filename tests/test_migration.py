"""Tests for migration module and author mapper."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from unittest import mock

import pytest
import yaml

from gitlab_downloader.author_mapper import AuthorMapper
from gitlab_downloader.migration import MigrationExecutor
from gitlab_downloader.models import (
    AuthorMapping,
    CommitterMapping,
    MigrationConfig,
)


class TestAuthorMapping:
    """Tests for AuthorMapping dataclass."""

    def test_author_mapping_creation(self):
        """Test creating an AuthorMapping instance."""
        mapping = AuthorMapping(
            original_name="John Doe",
            original_email="john@example.com",
            new_name="Jane Doe",
            new_email="jane@example.com",
        )

        assert mapping.original_name == "John Doe"
        assert mapping.original_email == "john@example.com"
        assert mapping.new_name == "Jane Doe"
        assert mapping.new_email == "jane@example.com"


class TestCommitterMapping:
    """Tests for CommitterMapping dataclass."""

    def test_committer_mapping_creation(self):
        """Test creating a CommitterMapping instance."""
        mapping = CommitterMapping(
            original_name="John Doe",
            original_email="john@example.com",
            new_name="Jane Doe",
            new_email="jane@example.com",
        )

        assert mapping.original_name == "John Doe"
        assert mapping.original_email == "john@example.com"
        assert mapping.new_name == "Jane Doe"
        assert mapping.new_email == "jane@example.com"


class TestMigrationConfig:
    """Tests for MigrationConfig dataclass."""

    def test_migration_config_creation(self):
        """Test creating a MigrationConfig instance."""
        author_mappings = {
            "john": AuthorMapping(
                original_name="John Doe",
                original_email="john@example.com",
                new_name="Jane Doe",
                new_email="jane@example.com",
            )
        }
        committer_mappings = {
            "john": CommitterMapping(
                original_name="John Doe",
                original_email="john@example.com",
                new_name="Jane Doe",
                new_email="jane@example.com",
            )
        }

        config = MigrationConfig(
            source_repos_path="/path/to/repos",
            target_hosting_url="https://github.com",
            target_token="token123",
            author_mappings=author_mappings,
            committer_mappings=committer_mappings,
        )

        assert config.source_repos_path == "/path/to/repos"
        assert config.target_hosting_url == "https://github.com"
        assert config.target_token == "token123"
        assert len(config.author_mappings) == 1
        assert len(config.committer_mappings) == 1


class TestAuthorMapperJSON:
    """Tests for AuthorMapper with JSON files."""

    def test_load_mappings_from_json(self):
        """Test loading mappings from JSON file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"
            config_data = {
                "author_mappings": {
                    "john": {
                        "original_name": "John Doe",
                        "original_email": "john@example.com",
                        "new_name": "Jane Doe",
                        "new_email": "jane@example.com",
                    }
                },
                "committer_mappings": {
                    "john": {
                        "original_name": "John Doe",
                        "original_email": "john@example.com",
                        "new_name": "Jane Doe",
                        "new_email": "jane@example.com",
                    }
                },
            }
            config_path.write_text(json.dumps(config_data))

            mapper = AuthorMapper(config_path)
            authors, committers = mapper.load_mappings()

            assert len(authors) == 1
            assert len(committers) == 1
            assert "john" in authors
            assert authors["john"].original_email == "john@example.com"
            assert authors["john"].new_name == "Jane Doe"

    def test_save_mappings_to_json(self):
        """Test saving mappings to JSON file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"

            author_mappings = {
                "john": AuthorMapping(
                    original_name="John Doe",
                    original_email="john@example.com",
                    new_name="Jane Doe",
                    new_email="jane@example.com",
                )
            }
            committer_mappings = {
                "john": CommitterMapping(
                    original_name="John Doe",
                    original_email="john@example.com",
                    new_name="Jane Doe",
                    new_email="jane@example.com",
                )
            }

            mapper = AuthorMapper(config_path)
            mapper.save_mappings(author_mappings, committer_mappings)

            assert config_path.exists()
            saved_data = json.loads(config_path.read_text())
            assert "author_mappings" in saved_data
            assert "committer_mappings" in saved_data
            assert saved_data["author_mappings"]["john"]["new_name"] == "Jane Doe"

    def test_load_nonexistent_json_file(self):
        """Test loading from nonexistent JSON file raises error."""
        config_path = Path("/nonexistent/config.json")
        mapper = AuthorMapper(config_path)

        with pytest.raises(FileNotFoundError):
            mapper.load_mappings()

    def test_load_invalid_json(self):
        """Test loading invalid JSON raises error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"
            config_path.write_text("invalid json {")

            mapper = AuthorMapper(config_path)
            with pytest.raises(ValueError):
                mapper.load_mappings()

    def test_load_non_dict_json(self):
        """Test loading JSON that's not a dict raises error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"
            config_path.write_text(json.dumps(["list", "instead", "of", "dict"]))

            mapper = AuthorMapper(config_path)
            with pytest.raises(ValueError):
                mapper.load_mappings()


class TestAuthorMapperYAML:
    """Tests for AuthorMapper with YAML files."""

    def test_load_mappings_from_yaml(self):
        """Test loading mappings from YAML file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.yaml"
            config_data = {
                "author_mappings": {
                    "john": {
                        "original_name": "John Doe",
                        "original_email": "john@example.com",
                        "new_name": "Jane Doe",
                        "new_email": "jane@example.com",
                    }
                },
                "committer_mappings": {
                    "john": {
                        "original_name": "John Doe",
                        "original_email": "john@example.com",
                        "new_name": "Jane Doe",
                        "new_email": "jane@example.com",
                    }
                },
            }
            config_path.write_text(yaml.dump(config_data))

            mapper = AuthorMapper(config_path)
            authors, committers = mapper.load_mappings()

            assert len(authors) == 1
            assert len(committers) == 1
            assert authors["john"].new_email == "jane@example.com"

    def test_save_mappings_to_yaml(self):
        """Test saving mappings to YAML file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.yaml"

            author_mappings = {
                "john": AuthorMapping(
                    original_name="John Doe",
                    original_email="john@example.com",
                    new_name="Jane Doe",
                    new_email="jane@example.com",
                )
            }
            committer_mappings = {}

            mapper = AuthorMapper(config_path)
            mapper.save_mappings(author_mappings, committer_mappings)

            assert config_path.exists()
            saved_data = yaml.safe_load(config_path.read_text())
            assert saved_data["author_mappings"]["john"]["new_name"] == "Jane Doe"

    def test_load_invalid_yaml(self):
        """Test loading invalid YAML raises error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.yaml"
            config_path.write_text("  invalid:\n    - yaml\n  : bad")

            mapper = AuthorMapper(config_path)
            # YAML parser will raise an error for truly invalid YAML
            with pytest.raises((ValueError, yaml.parser.ParserError)):
                mapper.load_mappings()


class TestAuthorMapperMigrationConfig:
    """Tests for AuthorMapper with full MigrationConfig."""

    def test_load_migration_config_from_json(self):
        """Test loading MigrationConfig from JSON."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "migration.json"
            config_data = {
                "source_repos_path": "/path/to/repos",
                "target_hosting_url": "https://github.com",
                "target_token": "token123",
                "author_mappings": {
                    "john": {
                        "original_name": "John Doe",
                        "original_email": "john@example.com",
                        "new_name": "Jane Doe",
                        "new_email": "jane@example.com",
                    }
                },
                "committer_mappings": {},
            }
            config_path.write_text(json.dumps(config_data))

            mapper = AuthorMapper(config_path)
            config = mapper.load_migration_config()

            assert config.source_repos_path == "/path/to/repos"
            assert config.target_hosting_url == "https://github.com"
            assert config.target_token == "token123"
            assert len(config.author_mappings) == 1

    def test_save_migration_config_to_json(self):
        """Test saving MigrationConfig to JSON."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "migration.json"

            config = MigrationConfig(
                source_repos_path="/path/to/repos",
                target_hosting_url="https://github.com",
                target_token="token123",
                author_mappings={
                    "john": AuthorMapping(
                        original_name="John Doe",
                        original_email="john@example.com",
                        new_name="Jane Doe",
                        new_email="jane@example.com",
                    )
                },
                committer_mappings={},
            )

            mapper = AuthorMapper(config_path)
            mapper.save_migration_config(config)

            assert config_path.exists()
            loaded_config = mapper.load_migration_config()
            assert loaded_config.source_repos_path == "/path/to/repos"
            assert loaded_config.target_token == "token123"

    def test_load_migration_config_missing_required_fields(self):
        """Test loading MigrationConfig with missing fields raises error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "migration.json"
            config_data = {
                "source_repos_path": "/path/to/repos",
                # Missing target_hosting_url and target_token
            }
            config_path.write_text(json.dumps(config_data))

            mapper = AuthorMapper(config_path)
            with pytest.raises(ValueError, match="Missing required config fields"):
                mapper.load_migration_config()

    def test_load_migration_config_from_yaml(self):
        """Test loading MigrationConfig from YAML."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "migration.yaml"
            config_data = {
                "source_repos_path": "/path/to/repos",
                "target_hosting_url": "https://gitlab.com",
                "target_token": "token456",
                "author_mappings": {},
                "committer_mappings": {
                    "jane": {
                        "original_name": "Jane Smith",
                        "original_email": "jane@example.com",
                        "new_name": "Jane Doe",
                        "new_email": "jane.doe@example.com",
                    }
                },
            }
            config_path.write_text(yaml.dump(config_data))

            mapper = AuthorMapper(config_path)
            config = mapper.load_migration_config()

            assert config.target_hosting_url == "https://gitlab.com"
            assert len(config.committer_mappings) == 1


class TestMigrationExecutor:
    """Tests for MigrationExecutor class."""

    def test_migration_executor_creation(self):
        """Test creating a MigrationExecutor instance."""
        config = MigrationConfig(
            source_repos_path="/path/to/repos",
            target_hosting_url="https://github.com",
            target_token="token123",
            author_mappings={},
            committer_mappings={},
        )

        executor = MigrationExecutor(config)
        assert executor.config == config
        assert executor.source_repos_path == Path("/path/to/repos")

    def test_create_author_mapping_script_single_mapping(self):
        """Test creating author mapping script with single mapping."""
        mappings = {
            "john": AuthorMapping(
                original_name="John Doe",
                original_email="john@example.com",
                new_name="Jane Doe",
                new_email="jane@example.com",
            )
        }

        script = MigrationExecutor._create_author_mapping_script(mappings)
        assert "john@example.com" in script
        assert "jane@example.com" in script
        assert "GIT_AUTHOR_EMAIL" in script
        assert "GIT_AUTHOR_NAME" in script

    def test_create_author_mapping_script_multiple_mappings(self):
        """Test creating author mapping script with multiple mappings."""
        mappings = {
            "john": AuthorMapping(
                original_name="John Doe",
                original_email="john@example.com",
                new_name="Jane Doe",
                new_email="jane@example.com",
            ),
            "bob": AuthorMapping(
                original_name="Bob Smith",
                original_email="bob@example.com",
                new_name="Robert Smith",
                new_email="robert@example.com",
            ),
        }

        script = MigrationExecutor._create_author_mapping_script(mappings)
        assert "john@example.com" in script
        assert "bob@example.com" in script
        assert "||" in script  # Should have OR operator between conditions

    def test_create_author_mapping_script_empty_mappings(self):
        """Test creating author mapping script with no mappings."""
        mappings = {}
        script = MigrationExecutor._create_author_mapping_script(mappings)
        assert script == "true"

    def test_create_committer_mapping_script_single_mapping(self):
        """Test creating committer mapping script with single mapping."""
        mappings = {
            "john": CommitterMapping(
                original_name="John Doe",
                original_email="john@example.com",
                new_name="Jane Doe",
                new_email="jane@example.com",
            )
        }

        script = MigrationExecutor._create_committer_mapping_script(mappings)
        assert "john@example.com" in script
        assert "jane@example.com" in script
        assert "GIT_COMMITTER_EMAIL" in script
        assert "GIT_COMMITTER_NAME" in script

    def test_create_committer_mapping_script_empty_mappings(self):
        """Test creating committer mapping script with no mappings."""
        mappings = {}
        script = MigrationExecutor._create_committer_mapping_script(mappings)
        assert script == "true"

    def test_replace_authors_no_git_repo(self):
        """Test replace_authors fails gracefully on non-git directory with mappings."""
        author_mappings = {
            "john": AuthorMapping(
                original_name="John Doe",
                original_email="john@example.com",
                new_name="Jane Doe",
                new_email="jane@example.com",
            )
        }
        config = MigrationConfig(
            source_repos_path="/tmp",
            target_hosting_url="https://github.com",
            target_token="token",
            author_mappings=author_mappings,
            committer_mappings={},
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            executor = MigrationExecutor(config)
            result = executor.replace_authors(tmpdir)
            assert result is False

    def test_replace_authors_no_mappings(self):
        """Test replace_authors returns True with no mappings."""
        config = MigrationConfig(
            source_repos_path="/tmp",
            target_hosting_url="https://github.com",
            target_token="token",
            author_mappings={},
            committer_mappings={},
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a valid git repo
            repo_path = Path(tmpdir)
            subprocess.run(["git", "init"], cwd=str(repo_path), capture_output=True)

            executor = MigrationExecutor(config)
            result = executor.replace_authors(repo_path)
            assert result is True

    def test_replace_committers_no_mappings(self):
        """Test replace_committers returns True with no mappings."""
        config = MigrationConfig(
            source_repos_path="/tmp",
            target_hosting_url="https://github.com",
            target_token="token",
            author_mappings={},
            committer_mappings={},
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a valid git repo
            repo_path = Path(tmpdir)
            subprocess.run(["git", "init"], cwd=str(repo_path), capture_output=True)

            executor = MigrationExecutor(config)
            result = executor.replace_committers(repo_path)
            assert result is True

    def test_migrate_repository_no_git_repo(self):
        """Test migrate_repository fails gracefully on non-git directory."""
        config = MigrationConfig(
            source_repos_path="/tmp",
            target_hosting_url="https://github.com",
            target_token="token",
            author_mappings={},
            committer_mappings={},
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            executor = MigrationExecutor(config)
            result = executor.migrate_repository(tmpdir)
            assert result is False

    def test_migrate_repository_with_callback(self):
        """Test migrate_repository calls progress callback."""
        config = MigrationConfig(
            source_repos_path="/tmp",
            target_hosting_url="https://github.com",
            target_token="token",
            author_mappings={},
            committer_mappings={},
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a valid git repo
            repo_path = Path(tmpdir)
            subprocess.run(["git", "init"], cwd=str(repo_path), capture_output=True)

            callback_messages = []

            def progress_callback(msg: str) -> None:
                callback_messages.append(msg)

            executor = MigrationExecutor(config)
            result = executor.migrate_repository(
                repo_path, progress_callback=progress_callback
            )

            assert result is True
            assert len(callback_messages) > 0
            assert any("Starting migration" in msg for msg in callback_messages)
            assert any("Migration completed" in msg for msg in callback_messages)

    def test_replace_authors_with_subprocess_error(self):
        """Test replace_authors handles subprocess errors gracefully."""
        config = MigrationConfig(
            source_repos_path="/tmp",
            target_hosting_url="https://github.com",
            target_token="token",
            author_mappings={
                "john": AuthorMapping(
                    original_name="John",
                    original_email="john@example.com",
                    new_name="Jane",
                    new_email="jane@example.com",
                )
            },
            committer_mappings={},
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            subprocess.run(["git", "init"], cwd=str(repo_path), capture_output=True)

            executor = MigrationExecutor(config)

            # Mock subprocess.run to return error
            with mock.patch("subprocess.run") as mock_run:
                mock_run.return_value = mock.Mock(
                    returncode=1, stderr="Some error occurred"
                )
                result = executor.replace_authors(repo_path)
                assert result is False
