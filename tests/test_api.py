"""Tests for API routes and schemas."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from gitlab_downloader.api import _parse_args, create_app
from gitlab_downloader.api_routes import _validate_path
from gitlab_downloader.api_schemas import (
    AuthorMappingRequest,
    MigrationStartRequest,
)
from gitlab_downloader.models import (
    AuthorMapping,
)


@pytest.fixture
def client() -> TestClient:
    """Create a test client for the FastAPI app."""
    app = create_app()
    return TestClient(app)


class TestStatusEndpoint:
    """Tests for /api/status endpoint."""

    def test_get_status(self, client: TestClient) -> None:
        """Test getting API status."""
        response = client.get("/api/status")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert "version" in data

    def test_status_response_schema(self, client: TestClient) -> None:
        """Test status response follows schema."""
        response = client.get("/api/status")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["status"], str)
        assert isinstance(data["version"], str)


class TestRepositoriesEndpoint:
    """Tests for /api/repos endpoint."""

    def test_list_repositories_empty_path(self, client: TestClient) -> None:
        """Test listing repos when clone_path doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            nonexistent = str(Path(tmpdir) / "nonexistent")
            response = client.get("/api/repos", params={"clone_path": nonexistent})
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 0
            assert data["repositories"] == []

    def test_list_repositories_no_repos(self, client: TestClient) -> None:
        """Test listing repos when directory exists but is empty."""
        with tempfile.TemporaryDirectory() as tmpdir:
            response = client.get("/api/repos", params={"clone_path": tmpdir})
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 0
            assert data["repositories"] == []

    def test_list_repositories_with_git_repos(self, client: TestClient) -> None:
        """Test listing repos when directory contains git repos."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a git-like directory structure
            repo_path = Path(tmpdir) / "test_repo"
            repo_path.mkdir()
            git_dir = repo_path / ".git"
            git_dir.mkdir()

            # Create a simple git config
            config_file = git_dir / "config"
            config_file.write_text('[remote "origin"]\n\turl = https://example.com/repo.git\n')

            response = client.get("/api/repos", params={"clone_path": tmpdir})
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 1
            assert len(data["repositories"]) == 1
            assert data["repositories"][0]["name"] == "test_repo"
            assert data["repositories"][0]["url"] == "https://example.com/repo.git"

    def test_list_repositories_ignores_non_git_dirs(self, client: TestClient) -> None:
        """Test that non-git directories are ignored."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a regular directory
            (Path(tmpdir) / "not_a_repo").mkdir()

            response = client.get("/api/repos", params={"clone_path": tmpdir})
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 0


class TestAuthorMappingsEndpoint:
    """Tests for /api/author-mappings endpoint."""

    @mock.patch("gitlab_downloader.api_routes.AuthorMapper")
    @mock.patch("gitlab_downloader.api_routes._validate_path")
    def test_get_author_mappings(
        self,
        mock_validate: mock.MagicMock,
        mock_mapper_class: mock.MagicMock,
        client: TestClient,
    ) -> None:
        """Test getting author mappings."""
        # Setup mocks
        mock_path = mock.MagicMock()
        mock_validate.return_value = mock_path
        config_file = mock_path / "migration_config.json"
        config_file.exists.return_value = True

        mock_mapper = mock.MagicMock()
        mock_mapper_class.return_value = mock_mapper

        test_mapping = AuthorMapping(
            original_name="John Doe",
            original_email="john@example.com",
            new_name="Jane Doe",
            new_email="jane@example.com",
        )
        mock_mapper.load_mappings.return_value = ({"john": test_mapping}, {})

        response = client.get("/api/author-mappings", params={"config_path": "."})
        assert response.status_code == 200
        data = response.json()
        assert "john" in data
        assert data["john"]["original_name"] == "John Doe"
        assert data["john"]["new_name"] == "Jane Doe"

    @mock.patch("gitlab_downloader.api_routes.ConfigFileManager")
    @mock.patch("gitlab_downloader.api_routes._validate_path")
    @mock.patch("gitlab_downloader.api_routes.AuthorMapper")
    def test_save_author_mappings(
        self,
        mock_mapper_class: mock.MagicMock,
        mock_validate: mock.MagicMock,
        mock_config_manager_class: mock.MagicMock,
        client: TestClient,
    ) -> None:
        """Test saving author mappings."""
        mock_mapper = mock.MagicMock()
        mock_mapper_class.return_value = mock_mapper

        mock_path = mock.MagicMock()
        mock_validate.return_value = mock_path

        # Mock ConfigFileManager.load_config to return valid config
        mock_config_manager = mock.MagicMock()
        mock_config_manager_class.load_config.return_value = mock_config_manager

        request_body = {
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

        mock_mapper.load_mappings.return_value = ({}, {})

        response = client.post(
            "/api/author-mappings", json=request_body, params={"config_path": "."}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "saved"
        mock_mapper.save_mappings.assert_called_once()

    @mock.patch("gitlab_downloader.api_routes.ConfigFileManager")
    @mock.patch("gitlab_downloader.api_routes._validate_path")
    @mock.patch("gitlab_downloader.api_routes.AuthorMapper")
    def test_save_author_mappings_invalid_config(
        self,
        mock_mapper_class: mock.MagicMock,
        mock_validate: mock.MagicMock,
        mock_config_manager_class: mock.MagicMock,
        client: TestClient,
    ) -> None:
        """Test saving author mappings fails if config becomes invalid."""
        mock_mapper = mock.MagicMock()
        mock_mapper_class.return_value = mock_mapper

        mock_path = mock.MagicMock()
        mock_validate.return_value = mock_path

        # Mock ConfigFileManager.load_config to raise ValueError (invalid config)
        mock_config_manager_class.load_config.side_effect = ValueError(
            "Missing required field: source_repos_path"
        )

        request_body = {
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

        response = client.post(
            "/api/author-mappings", json=request_body, params={"config_path": "."}
        )
        assert response.status_code == 400
        data = response.json()
        assert "Cannot save mappings" in data["detail"]

    def test_save_author_mappings_integration_invalid_config(
        self, tmp_path, client: TestClient
    ) -> None:
        """Integration test: ensure no file is written if config is invalid."""
        import json

        config_dir = tmp_path / "config"
        config_dir.mkdir()

        # Create a minimal invalid config (missing required fields)
        config_file = config_dir / "migration_config.json"
        config_file.write_text(json.dumps({"author_mappings": {}, "committer_mappings": {}}))

        request_body = {
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

        # Try to save mappings with invalid config
        response = client.post(
            "/api/author-mappings", json=request_body, params={"config_path": str(config_dir)}
        )

        # Should fail with 400
        assert response.status_code == 400
        data = response.json()
        assert "Cannot save mappings" in data["detail"]

        # Verify config file still has only the original content (no mappings were added)
        config_content = json.loads(config_file.read_text())
        assert "author_mappings" in config_content
        assert config_content["author_mappings"] == {}  # Should not have new mappings

    def test_save_author_mappings_integration_missing_config(
        self, tmp_path, client: TestClient
    ) -> None:
        """Integration test: ensure error when config file is missing completely."""
        config_dir = tmp_path / "config"
        config_dir.mkdir()
        # Don't create any config file

        request_body = {
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

        # Try to save mappings without any config file
        response = client.post(
            "/api/author-mappings", json=request_body, params={"config_path": str(config_dir)}
        )

        # Should fail with 400
        assert response.status_code == 400
        data = response.json()
        assert "Cannot save mappings" in data["detail"]

        # Verify no config file was created
        assert not (config_dir / "migration_config.json").exists()
        assert not (config_dir / "migration_config.yaml").exists()
        assert not (config_dir / "migration_config.yml").exists()


class TestMigrationEndpoint:
    """Tests for /api/migrate endpoint."""

    @mock.patch("gitlab_downloader.api_routes.MigrationExecutor")
    @mock.patch("gitlab_downloader.api_routes.asyncio.create_task")
    def test_start_migration(
        self,
        mock_create_task: mock.MagicMock,
        mock_executor_class: mock.MagicMock,
        tmp_path: Path,
        client: TestClient,
    ) -> None:
        """Test starting a migration."""
        request_data = {
            "repo_path": str(tmp_path),
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

        response = client.post("/api/migrate", json=request_data)
        assert response.status_code == 200
        data = response.json()
        assert "migration_id" in data
        assert len(data["migration_id"]) > 0

    def test_start_migration_empty_mappings(
        self, tmp_path: Path, client: TestClient
    ) -> None:
        """Test starting migration with empty mappings."""
        request_data = {
            "repo_path": str(tmp_path),
            "author_mappings": {},
            "committer_mappings": {},
        }

        response = client.post("/api/migrate", json=request_data)
        assert response.status_code == 200
        data = response.json()
        assert "migration_id" in data


class TestMigrationProgressEndpoint:
    """Tests for /api/migration-progress endpoint."""

    def test_migration_progress_not_found(self, client: TestClient) -> None:
        """Test getting progress for non-existent migration."""
        response = client.get("/api/migration-progress/nonexistent-id")
        assert response.status_code == 404

    @mock.patch("gitlab_downloader.api_routes.MigrationExecutor")
    @mock.patch("gitlab_downloader.api_routes.asyncio.create_task")
    def test_migration_progress_pending(
        self,
        mock_create_task: mock.MagicMock,
        mock_executor_class: mock.MagicMock,
        tmp_path: Path,
        client: TestClient,
    ) -> None:
        """Test getting progress for pending migration."""
        # Start a migration
        request_data = {
            "repo_path": str(tmp_path),
            "author_mappings": {},
            "committer_mappings": {},
        }

        start_response = client.post("/api/migrate", json=request_data)
        migration_id = start_response.json()["migration_id"]

        # Get progress
        progress_response = client.get(f"/api/migration-progress/{migration_id}")
        assert progress_response.status_code == 200
        data = progress_response.json()
        assert data["migration_id"] == migration_id
        assert data["status"] == "pending"
        assert data["progress"] == 0


class TestErrorHandling:
    """Tests for error handling."""

    @mock.patch("gitlab_downloader.api_routes._validate_path")
    @mock.patch("gitlab_downloader.api_routes.AuthorMapper")
    def test_author_mappings_read_error(
        self,
        mock_mapper_class: mock.MagicMock,
        mock_validate: mock.MagicMock,
        client: TestClient,
    ) -> None:
        """Test error handling when reading author mappings fails."""
        mock_path_instance = mock.MagicMock()
        mock_validate.return_value = mock_path_instance
        config_file = mock_path_instance / "migration_config.json"
        config_file.exists.return_value = True

        mock_mapper = mock.MagicMock()
        mock_mapper_class.return_value = mock_mapper
        mock_mapper.load_mappings.side_effect = OSError("File not found")

        response = client.get("/api/author-mappings", params={"config_path": "."})
        assert response.status_code == 500

    @mock.patch("gitlab_downloader.api_routes.ConfigFileManager")
    @mock.patch("gitlab_downloader.api_routes.AuthorMapper")
    def test_author_mappings_write_error(
        self,
        mock_mapper_class: mock.MagicMock,
        mock_config_manager: mock.MagicMock,
        client: TestClient,
    ) -> None:
        """Test error handling when saving author mappings fails."""
        mock_mapper = mock.MagicMock()
        mock_mapper_class.return_value = mock_mapper
        mock_mapper.load_mappings.side_effect = FileNotFoundError()
        mock_mapper.save_mappings.side_effect = OSError("Permission denied")
        # Mock ConfigFileManager.load_config to return a valid config
        mock_config_manager.load_config.return_value = mock.MagicMock()

        request_body = {
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

        response = client.post(
            "/api/author-mappings", json=request_body, params={"config_path": "."}
        )
        assert response.status_code == 500


class TestAPISchemas:
    """Tests for Pydantic schemas."""

    def test_author_mapping_request_validation(self) -> None:
        """Test AuthorMappingRequest validation."""
        valid_data = {
            "original_name": "John Doe",
            "original_email": "john@example.com",
            "new_name": "Jane Doe",
            "new_email": "jane@example.com",
        }
        req = AuthorMappingRequest(**valid_data)
        assert req.original_name == "John Doe"
        assert req.new_email == "jane@example.com"

    def test_migration_start_request_validation(self) -> None:
        """Test MigrationStartRequest validation."""
        request_data = {
            "repo_path": "/path/to/repo",
            "author_mappings": {},
            "committer_mappings": {},
        }
        req = MigrationStartRequest(**request_data)
        assert req.repo_path == "/path/to/repo"
        assert req.author_mappings == {}

    def test_migration_start_request_with_mappings(self) -> None:
        """Test MigrationStartRequest with mappings."""
        request_data = {
            "repo_path": "/path/to/repo",
            "author_mappings": {
                "john": {
                    "original_name": "John Doe",
                    "original_email": "john@example.com",
                    "new_name": "Jane Doe",
                    "new_email": "jane@example.com",
                }
            },
            "committer_mappings": {
                "alice": {
                    "original_name": "Alice Smith",
                    "original_email": "alice@example.com",
                    "new_name": "Bob Smith",
                    "new_email": "bob@example.com",
                }
            },
        }
        req = MigrationStartRequest(**request_data)
        assert len(req.author_mappings) == 1
        assert len(req.committer_mappings) == 1


class TestApiModuleInvocation:
    """Tests for api.py CLI argument parsing and module invocation."""

    def test_parse_args_defaults(self) -> None:
        """Test default argument values."""
        args = _parse_args([])
        assert args.host == "127.0.0.1"
        assert args.port == 8001

    def test_parse_args_custom_host_and_port(self) -> None:
        """Test custom host and port arguments."""
        args = _parse_args(["--host", "0.0.0.0", "--port", "9999"])
        assert args.host == "0.0.0.0"
        assert args.port == 9999

    def test_parse_args_only_host(self) -> None:
        """Test specifying only host."""
        args = _parse_args(["--host", "192.168.1.1"])
        assert args.host == "192.168.1.1"
        assert args.port == 8001

    def test_parse_args_only_port(self) -> None:
        """Test specifying only port."""
        args = _parse_args(["--port", "3000"])
        assert args.host == "127.0.0.1"
        assert args.port == 3000

    def test_main_block_calls_run_api_server(self) -> None:
        """Test that __main__ block invokes run_api_server_async with parsed args."""
        import runpy

        argv = ["gitlab_downloader.api", "--host", "127.0.0.1", "--port", "19999"]
        with (
            mock.patch("sys.argv", argv),
            mock.patch("gitlab_downloader.api.asyncio.run") as mock_asyncio_run,
            mock.patch("gitlab_downloader.api.run_api_server_async"),
        ):
            mock_asyncio_run.return_value = None
            try:
                runpy.run_module("gitlab_downloader.api", run_name="__main__")
            except SystemExit:
                pass

            mock_asyncio_run.assert_called_once()
            call_args = mock_asyncio_run.call_args[0][0]
            # The coroutine was created with the parsed args
            # Close the coroutine to avoid RuntimeWarning
            call_args.close()


class TestValidatePath:
    """Tests for _validate_path boundary validation."""

    def test_valid_path_within_home(self, tmp_path: Path) -> None:
        """Test that a path within home directory is accepted."""
        # tmp_path is under the system temp dir; use it as explicit base_dir
        result = _validate_path(str(tmp_path), base_dir=tmp_path)
        assert result == tmp_path.resolve()

    def test_valid_subpath_within_base(self, tmp_path: Path) -> None:
        """Test that a sub-path within base directory is accepted."""
        subdir = tmp_path / "sub" / "dir"
        subdir.mkdir(parents=True)
        result = _validate_path(str(subdir), base_dir=tmp_path)
        assert result == subdir.resolve()

    def test_rejects_path_outside_base_dir(self, tmp_path: Path) -> None:
        """Test that a path outside the base directory is rejected."""
        base = tmp_path / "allowed"
        base.mkdir()
        outside = tmp_path / "forbidden"
        outside.mkdir()
        with pytest.raises(ValueError, match="resolves outside allowed directories"):
            _validate_path(str(outside), base_dir=base)

    def test_rejects_traversal_with_dotdot(self, tmp_path: Path) -> None:
        """Test that '..' path components are rejected."""
        subdir = tmp_path / "sub"
        subdir.mkdir()
        with pytest.raises(ValueError, match="Path traversal not allowed"):
            _validate_path(str(subdir) + "/../etc/passwd", base_dir=tmp_path)

    def test_rejects_root_path(self, tmp_path: Path) -> None:
        """Test that root path is rejected when base_dir is a subdirectory."""
        with pytest.raises(ValueError, match="resolves outside allowed directories"):
            _validate_path("/", base_dir=tmp_path)

    def test_rejects_etc_passwd(self, tmp_path: Path) -> None:
        """Test that /etc/passwd is rejected with a restricted base_dir."""
        with pytest.raises(ValueError, match="resolves outside allowed directories"):
            _validate_path("/etc/passwd", base_dir=tmp_path)

    def test_default_base_dir_is_home(self) -> None:
        """Test that default base_dir uses _allowed_base_dirs (which includes home)."""
        home = Path.home()
        result = _validate_path(str(home))
        assert result == home.resolve()

    def test_rejects_outside_all_allowed_dirs(self) -> None:
        """Test that paths outside all allowed base dirs are rejected."""
        import gitlab_downloader.api_routes as routes

        # Temporarily set _allowed_base_dirs to a single restricted directory
        original = routes._allowed_base_dirs.copy()
        try:
            routes._allowed_base_dirs[:] = [Path.home().resolve()]
            # /nonexistent is definitely not under home
            with pytest.raises(ValueError, match="resolves outside allowed directories"):
                _validate_path("/nonexistent")
        finally:
            routes._allowed_base_dirs[:] = original

    def test_repos_endpoint_rejects_traversal(self, client: TestClient) -> None:
        """Test that /api/repos rejects path traversal."""
        response = client.get(
            "/api/repos", params={"clone_path": "/tmp/../etc/shadow"}
        )
        assert response.status_code == 400

    def test_config_endpoint_rejects_traversal(self, client: TestClient) -> None:
        """Test that /api/config rejects path traversal."""
        response = client.get(
            "/api/config", params={"repo_path": "/tmp/../etc"}
        )
        assert response.status_code == 400


class TestSanitizeRepoUrl:
    """Tests for _sanitize_repo_url."""

    def test_empty_url(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        assert _sanitize_repo_url("") == ""

    def test_https_url_without_credentials(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        url = "https://gitlab.com/group/repo.git"
        assert _sanitize_repo_url(url) == "https://gitlab.com/group/repo.git"

    def test_https_url_with_credentials(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        url = "https://oauth2:mytoken@gitlab.com/group/repo.git"
        result = _sanitize_repo_url(url)
        assert "mytoken" not in result
        assert "oauth2" not in result
        assert "gitlab.com" in result

    def test_https_url_with_port(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        url = "https://user:pass@gitlab.com:8443/group/repo.git"
        result = _sanitize_repo_url(url)
        assert "user" not in result
        assert "pass" not in result
        assert "8443" in result

    def test_ssh_url(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        url = "git@gitlab.com:group/repo.git"
        assert _sanitize_repo_url(url) == url

    def test_plain_path_no_at(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        assert _sanitize_repo_url("/path/to/repo") == "/path/to/repo"

    def test_rejects_credential_like_pattern(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        result = _sanitize_repo_url("user:password@host:path")
        assert result == ""

    def test_rejects_url_without_colon_after_at(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        result = _sanitize_repo_url("user@hostpath")
        assert result == ""

    def test_rejects_invalid_host_with_slash(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        result = _sanitize_repo_url("user@ho/st:path")
        assert result == ""

    def test_strips_query_params(self) -> None:
        from gitlab_downloader.api_routes import _sanitize_repo_url

        url = "https://gitlab.com/repo.git?token=secret"
        result = _sanitize_repo_url(url)
        assert "secret" not in result
        assert "token" not in result


class TestConfigEndpoint:
    """Tests for /api/config endpoints."""

    @mock.patch("gitlab_downloader.api_routes.ConfigFileManager")
    def test_get_config_not_found(
        self, mock_cfm: mock.MagicMock, tmp_path: Path, client: TestClient
    ) -> None:
        """Test getting config when no config file exists."""
        mock_cfm.load_config.return_value = None
        response = client.get("/api/config", params={"repo_path": str(tmp_path)})
        assert response.status_code == 200
        data = response.json()
        assert data["found"] is False
        assert data["config"] is None

    @mock.patch("gitlab_downloader.api_routes.ConfigFileManager")
    def test_get_config_found(
        self, mock_cfm: mock.MagicMock, tmp_path: Path, client: TestClient
    ) -> None:
        """Test getting config when config exists."""
        mock_config = mock.MagicMock()
        mock_config.source_repos_path = "/src"
        mock_config.target_hosting_url = "https://target.com"
        mock_config.author_mappings = {}
        mock_config.committer_mappings = {}
        mock_cfm.load_config.return_value = mock_config

        response = client.get("/api/config", params={"repo_path": str(tmp_path)})
        assert response.status_code == 200
        data = response.json()
        assert data["found"] is True
        assert data["config"]["source_repos_path"] == "/src"

    @mock.patch("gitlab_downloader.api_routes.ConfigFileManager")
    def test_get_config_error(
        self, mock_cfm: mock.MagicMock, tmp_path: Path, client: TestClient
    ) -> None:
        """Test get_config error handling."""
        mock_cfm.load_config.side_effect = RuntimeError("disk error")
        response = client.get("/api/config", params={"repo_path": str(tmp_path)})
        assert response.status_code == 500

    @mock.patch("gitlab_downloader.api_routes.ConfigFileManager")
    def test_save_config(
        self, mock_cfm: mock.MagicMock, tmp_path: Path, client: TestClient
    ) -> None:
        """Test saving config."""
        request_data = {
            "repo_path": str(tmp_path),
            "source_repos_path": str(tmp_path),
            "target_hosting_url": "https://target.gitlab.com",
            "target_token": "tok123",
            "author_mappings": {},
            "committer_mappings": {},
            "format": "json",
        }
        response = client.post("/api/config", json=request_data)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "saved"
        mock_cfm.save_config.assert_called_once()

    @mock.patch("gitlab_downloader.api_routes.ConfigFileManager")
    def test_save_config_error(
        self, mock_cfm: mock.MagicMock, tmp_path: Path, client: TestClient
    ) -> None:
        """Test save_config error handling."""
        mock_cfm.save_config.side_effect = RuntimeError("write error")
        request_data = {
            "repo_path": str(tmp_path),
            "source_repos_path": str(tmp_path),
            "target_hosting_url": "https://target.gitlab.com",
            "target_token": "tok123",
            "author_mappings": {},
            "committer_mappings": {},
            "format": "json",
        }
        response = client.post("/api/config", json=request_data)
        assert response.status_code == 500


class TestFindGitRepos:
    """Tests for _find_git_repos."""

    def test_max_depth_exceeded(self, tmp_path: Path) -> None:
        """Test that max_depth prevents infinite recursion."""
        from gitlab_downloader.api_routes import _find_git_repos

        result = _find_git_repos(tmp_path, max_depth=10, current_depth=11)
        assert result == []

    def test_skips_symlinked_git_dir(self, tmp_path: Path) -> None:
        """Test that symlinked .git directories are skipped."""
        import os

        from gitlab_downloader.api_routes import _find_git_repos

        repo = tmp_path / "repo"
        repo.mkdir()
        real_git = tmp_path / "real_git"
        real_git.mkdir()
        os.symlink(str(real_git), str(repo / ".git"))

        result = _find_git_repos(tmp_path)
        assert len(result) == 0

    def test_skips_symlinked_config(self, tmp_path: Path) -> None:
        """Test that symlinked git config files are skipped."""
        import os

        from gitlab_downloader.api_routes import _find_git_repos

        repo = tmp_path / "repo"
        repo.mkdir()
        git_dir = repo / ".git"
        git_dir.mkdir()
        real_config = tmp_path / "real_config"
        real_config.write_text('[remote "origin"]\n\turl = https://example.com/repo.git\n')
        os.symlink(str(real_config), str(git_dir / "config"))

        result = _find_git_repos(tmp_path)
        assert len(result) == 1
        assert result[0].url == ""  # URL should be empty since config is symlinked

    def test_handles_permission_error(self, tmp_path: Path) -> None:
        """Test graceful handling of PermissionError."""
        from gitlab_downloader.api_routes import _find_git_repos

        unreadable = tmp_path / "unreadable"
        unreadable.mkdir()
        unreadable.chmod(0o000)

        try:
            result = _find_git_repos(tmp_path)
            # The unreadable dir will either be skipped or cause a PermissionError
            # which is caught internally
            assert isinstance(result, list)
        finally:
            unreadable.chmod(0o755)

    def test_nested_git_repos(self, tmp_path: Path) -> None:
        """Test finding nested git repos."""
        from gitlab_downloader.api_routes import _find_git_repos

        group = tmp_path / "group"
        group.mkdir()
        repo = group / "repo"
        repo.mkdir()
        (repo / ".git").mkdir()

        result = _find_git_repos(tmp_path)
        assert len(result) == 1
        assert result[0].name == "repo"

    def test_repo_without_remote_url(self, tmp_path: Path) -> None:
        """Test repo with .git but no remote origin."""
        from gitlab_downloader.api_routes import _find_git_repos

        repo = tmp_path / "repo"
        repo.mkdir()
        git_dir = repo / ".git"
        git_dir.mkdir()
        (git_dir / "config").write_text("[core]\n\tbare = false\n")

        result = _find_git_repos(tmp_path)
        assert len(result) == 1
        assert result[0].url == ""


class TestReposEndpointIntegration:
    """Integration tests for /api/repos endpoint."""

    def test_repos_empty_clone_path_param(self, client: TestClient) -> None:
        """Test that empty clone_path returns empty result."""
        response = client.get("/api/repos", params={"clone_path": ""})
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0

    def test_repos_no_param(self, client: TestClient) -> None:
        """Test that missing clone_path returns empty result."""
        response = client.get("/api/repos")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
