"""Tests for CLI UI module."""

from __future__ import annotations

import json

import yaml

from gitlab_downloader.author_mapper import AuthorMapper
from gitlab_downloader.cli_ui import CLIMenu
from gitlab_downloader.models import (
    AuthorMapping,
    MigrationConfig,
)


class TestCLIMenu:
    """Tests for CLIMenu class."""

    def test_menu_initialization(self):
        """Test CLIMenu initialization."""
        menu = CLIMenu()
        assert menu.console is not None

    def test_show_main_menu_clone(self, monkeypatch):
        """Test main menu returns 'clone' option."""
        monkeypatch.setattr("builtins.input", lambda *_: "1")
        menu = CLIMenu()
        result = menu.show_main_menu()
        assert result == "clone"

    def test_show_main_menu_migrate(self, monkeypatch):
        """Test main menu returns 'migrate' option."""
        monkeypatch.setattr("builtins.input", lambda *_: "2")
        menu = CLIMenu()
        result = menu.show_main_menu()
        assert result == "migrate"

    def test_show_main_menu_history(self, monkeypatch):
        """Test main menu returns 'history' option."""
        monkeypatch.setattr("builtins.input", lambda *_: "3")
        menu = CLIMenu()
        result = menu.show_main_menu()
        assert result == "history"

    def test_show_main_menu_exit(self, monkeypatch):
        """Test main menu returns 'exit' option."""
        monkeypatch.setattr("builtins.input", lambda *_: "4")
        menu = CLIMenu()
        result = menu.show_main_menu()
        assert result == "exit"

    def test_show_main_menu_invalid_then_valid(self, monkeypatch):
        """Test main menu handles invalid input then valid."""
        inputs = iter(["invalid", "1"])
        monkeypatch.setattr("builtins.input", lambda *_: next(inputs))
        menu = CLIMenu()
        result = menu.show_main_menu()
        assert result == "clone"

    def test_show_clone_menu(self, monkeypatch):
        """Test clone menu returns configuration."""
        inputs = iter(
            [
                "https://gitlab.com",
                "my-group",
                "/home/user/repos",
            ]
        )

        def mock_input(*_, **__):
            return next(inputs)

        monkeypatch.setattr("builtins.input", mock_input)
        monkeypatch.setattr(
            "gitlab_downloader.cli_ui._getpass_module.getpass", lambda *_, **__: "token123"
        )

        menu = CLIMenu()
        result = menu.show_clone_menu()

        assert result["url"] == "https://gitlab.com"
        assert result["token"] == "token123"
        assert result["group"] == "my-group"
        assert result["clone_path"] == "/home/user/repos"

    def test_show_clone_menu_empty_group(self, monkeypatch):
        """Test clone menu with empty group."""
        inputs = iter(
            [
                "https://gitlab.com",
                "",
                "/home/user/repos",
            ]
        )

        def mock_input(*_, **__):
            return next(inputs)

        monkeypatch.setattr("builtins.input", mock_input)
        monkeypatch.setattr(
            "gitlab_downloader.cli_ui._getpass_module.getpass", lambda *_, **__: "token123"
        )

        menu = CLIMenu()
        result = menu.show_clone_menu()

        assert result["group"] is None

    def test_configure_author_mappings_single(self, monkeypatch):
        """Test author mappings configuration."""
        inputs = iter(
            [
                "y",  # Add mapping
                "john@example.com",  # Original email
                "John Doe",  # Original name
                "jane@example.com",  # New email
                "Jane Doe",  # New name
                "n",  # Add another
            ]
        )
        monkeypatch.setattr(
            "builtins.input",
            lambda *_, **__: next(inputs),
        )

        menu = CLIMenu()
        result = menu._configure_author_mappings()

        assert len(result) == 1
        assert "mapping_1" in result
        mapping = result["mapping_1"]
        assert mapping.original_email == "john@example.com"
        assert mapping.original_name == "John Doe"
        assert mapping.new_email == "jane@example.com"
        assert mapping.new_name == "Jane Doe"

    def test_configure_author_mappings_multiple(self, monkeypatch):
        """Test multiple author mappings."""
        inputs = iter(
            [
                "y",  # Add mapping 1
                "john@example.com",
                "John",
                "jane@example.com",
                "Jane",
                "y",  # Add mapping 2
                "bob@example.com",
                "Bob",
                "alice@example.com",
                "Alice",
                "n",  # Stop
            ]
        )
        monkeypatch.setattr(
            "builtins.input",
            lambda *_, **__: next(inputs),
        )

        menu = CLIMenu()
        result = menu._configure_author_mappings()

        assert len(result) == 2
        assert result["mapping_1"].original_email == "john@example.com"
        assert result["mapping_2"].original_email == "bob@example.com"

    def test_configure_committer_mappings(self, monkeypatch):
        """Test committer mappings configuration."""
        inputs = iter(
            [
                "y",  # Add mapping
                "committer@example.com",
                "Original Committer",
                "new_committer@example.com",
                "New Committer",
                "n",  # Stop
            ]
        )
        monkeypatch.setattr(
            "builtins.input",
            lambda *_, **__: next(inputs),
        )

        menu = CLIMenu()
        result = menu._configure_committer_mappings()

        assert len(result) == 1
        assert result["mapping_1"].original_email == "committer@example.com"

    def test_show_migration_wizard_success(self, monkeypatch, tmp_path):
        """Test migration wizard returns config."""
        test_repo_path = tmp_path / "repos"
        test_repo_path.mkdir()

        inputs = iter(
            [
                str(test_repo_path),  # Source path
                "https://target.com",  # Target URL
                "n",  # No author mappings
                "n",  # No committer mappings
                "y",  # Proceed
            ]
        )

        def mock_input(*_, **__):
            return next(inputs)

        monkeypatch.setattr("builtins.input", mock_input)
        monkeypatch.setattr(
            "gitlab_downloader.cli_ui._getpass_module.getpass", lambda *_, **__: "target_token"
        )

        menu = CLIMenu()
        result = menu.show_migration_wizard()

        assert result is not None
        assert result.source_repos_path == str(test_repo_path)
        assert result.target_hosting_url == "https://target.com"
        assert result.target_token == "target_token"

    def test_show_migration_wizard_invalid_path(self, monkeypatch):
        """Test migration wizard with invalid path."""
        inputs = iter(
            [
                "/nonexistent/path",
            ]
        )
        monkeypatch.setattr(
            "builtins.input",
            lambda *_, **__: next(inputs),
        )

        menu = CLIMenu()
        result = menu.show_migration_wizard()

        assert result is None

    def test_show_migration_wizard_cancelled(self, monkeypatch, tmp_path):
        """Test migration wizard can be cancelled."""
        test_repo_path = tmp_path / "repos"
        test_repo_path.mkdir()

        inputs = iter(
            [
                str(test_repo_path),
                "https://target.com",
                "n",
                "n",
                "n",  # Don't proceed
            ]
        )

        def mock_input(*_, **__):
            return next(inputs)

        monkeypatch.setattr("builtins.input", mock_input)
        monkeypatch.setattr(
            "gitlab_downloader.cli_ui._getpass_module.getpass", lambda *_, **__: "token"
        )

        menu = CLIMenu()
        result = menu.show_migration_wizard()

        assert result is None

    def test_save_migration_config_json(self, monkeypatch, tmp_path):
        """Test saving migration config as JSON."""
        config = MigrationConfig(
            source_repos_path="/repos",
            target_hosting_url="https://target.com",
            target_token="token",
            author_mappings={},
            committer_mappings={},
        )

        output_file = tmp_path / "config.json"

        inputs = iter(
            [
                "json",  # Format
                str(output_file),  # Path
            ]
        )
        monkeypatch.setattr(
            "builtins.input",
            lambda *_, **__: next(inputs),
        )

        menu = CLIMenu()
        result = menu.save_migration_config(config)

        assert result == str(output_file)
        assert output_file.exists()

        data = json.loads(output_file.read_text())
        assert data["source_repos_path"] == "/repos"
        assert data["target_hosting_url"] == "https://target.com"

    def test_save_migration_config_yaml(self, monkeypatch, tmp_path):
        """Test saving migration config as YAML."""
        config = MigrationConfig(
            source_repos_path="/repos",
            target_hosting_url="https://target.com",
            target_token="token",
            author_mappings={},
            committer_mappings={},
        )

        output_file = tmp_path / "config.yaml"

        inputs = iter(
            [
                "yaml",  # Format
                str(output_file),  # Path
            ]
        )
        monkeypatch.setattr(
            "builtins.input",
            lambda *_, **__: next(inputs),
        )

        menu = CLIMenu()
        result = menu.save_migration_config(config)

        assert result == str(output_file)
        assert output_file.exists()

        data = yaml.safe_load(output_file.read_text())
        assert data["source_repos_path"] == "/repos"

    def test_show_history_menu_valid_config(self, monkeypatch, tmp_path):
        """Test history menu with valid config."""
        config = MigrationConfig(
            source_repos_path="/repos",
            target_hosting_url="https://target.com",
            target_token="token",
            author_mappings={},
            committer_mappings={},
        )

        config_file = tmp_path / "config.json"
        mapper = AuthorMapper(config_file)
        mapper.save_migration_config(config)

        monkeypatch.setattr(
            "builtins.input",
            lambda *_, **__: str(config_file),
        )

        menu = CLIMenu()
        result = menu.show_history_menu()

        assert result == str(config_file)

    def test_show_history_menu_invalid_config(self, monkeypatch):
        """Test history menu with invalid config file."""
        monkeypatch.setattr(
            "builtins.input",
            lambda *_, **__: "/nonexistent/config.json",
        )

        menu = CLIMenu()
        result = menu.show_history_menu()

        assert result is None

    def test_show_success_message(self, capsys):
        """Test success message display."""
        menu = CLIMenu()
        menu.show_success_message("Operation completed")
        captured = capsys.readouterr()
        assert "Operation completed" in captured.out

    def test_show_error_message(self, capsys):
        """Test error message display."""
        menu = CLIMenu()
        menu.show_error_message("Operation failed")
        captured = capsys.readouterr()
        assert "Operation failed" in captured.out

    def test_show_info_message(self, capsys):
        """Test info message display."""
        menu = CLIMenu()
        menu.show_info_message("Processing")
        captured = capsys.readouterr()
        assert "Processing" in captured.out


class TestMigrationConfigInteraction:
    """Tests for migration configuration interaction."""

    def test_create_and_load_config_json(self, tmp_path):
        """Test creating and loading migration config as JSON."""
        config = MigrationConfig(
            source_repos_path=str(tmp_path / "repos"),
            target_hosting_url="https://target.com",
            target_token="secret_token",
            author_mappings={
                "author1": AuthorMapping(
                    original_name="John",
                    original_email="john@old.com",
                    new_name="Jane",
                    new_email="jane@new.com",
                )
            },
            committer_mappings={},
        )

        config_file = tmp_path / "migration.json"
        mapper = AuthorMapper(config_file)
        mapper.save_migration_config(config)

        loaded = mapper.load_migration_config()
        assert loaded.source_repos_path == config.source_repos_path
        assert loaded.target_hosting_url == config.target_hosting_url
        assert len(loaded.author_mappings) == 1
        assert loaded.author_mappings["author1"].new_email == "jane@new.com"

    def test_create_and_load_config_yaml(self, tmp_path):
        """Test creating and loading migration config as YAML."""
        config = MigrationConfig(
            source_repos_path=str(tmp_path / "repos"),
            target_hosting_url="https://target.com",
            target_token="secret_token",
            author_mappings={},
            committer_mappings={},
        )

        config_file = tmp_path / "migration.yaml"
        mapper = AuthorMapper(config_file)
        mapper.save_migration_config(config)

        loaded = mapper.load_migration_config()
        assert loaded.source_repos_path == config.source_repos_path
