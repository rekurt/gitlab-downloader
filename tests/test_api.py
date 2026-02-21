"""Tests for API routes and schemas."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from gitlab_downloader.api import create_app
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
    @mock.patch("gitlab_downloader.api_routes.Path")
    def test_get_author_mappings(
        self, mock_path_class: mock.MagicMock, mock_mapper_class: mock.MagicMock, client: TestClient
    ) -> None:
        """Test getting author mappings."""
        # Setup mocks
        mock_path = mock.MagicMock()
        mock_path_class.return_value = mock_path
        mock_path.exists.return_value = True

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

    @mock.patch("gitlab_downloader.api_routes.Path")
    @mock.patch("gitlab_downloader.api_routes.AuthorMapper")
    def test_save_author_mappings(
        self, mock_mapper_class: mock.MagicMock, mock_path_class: mock.MagicMock, client: TestClient
    ) -> None:
        """Test saving author mappings."""
        mock_mapper = mock.MagicMock()
        mock_mapper_class.return_value = mock_mapper

        mock_path = mock.MagicMock()
        mock_path_class.return_value = mock_path

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


class TestMigrationEndpoint:
    """Tests for /api/migrate endpoint."""

    @mock.patch("gitlab_downloader.api_routes.MigrationExecutor")
    @mock.patch("gitlab_downloader.api_routes.asyncio.create_task")
    def test_start_migration(
        self,
        mock_create_task: mock.MagicMock,
        mock_executor_class: mock.MagicMock,
        client: TestClient,
    ) -> None:
        """Test starting a migration."""
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
            "committer_mappings": {},
        }

        response = client.post("/api/migrate", json=request_data)
        assert response.status_code == 200
        data = response.json()
        assert "migration_id" in data
        assert len(data["migration_id"]) > 0

    def test_start_migration_empty_mappings(self, client: TestClient) -> None:
        """Test starting migration with empty mappings."""
        request_data = {
            "repo_path": "/path/to/repo",
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
        client: TestClient,
    ) -> None:
        """Test getting progress for pending migration."""
        # Start a migration
        request_data = {
            "repo_path": "/path/to/repo",
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

    @mock.patch("gitlab_downloader.api_routes.Path")
    @mock.patch("gitlab_downloader.api_routes.AuthorMapper")
    def test_author_mappings_read_error(
        self, mock_mapper_class: mock.MagicMock, mock_path_class: mock.MagicMock, client: TestClient
    ) -> None:
        """Test error handling when reading author mappings fails."""
        mock_mapper = mock.MagicMock()
        mock_mapper_class.return_value = mock_mapper
        mock_mapper.load_mappings.side_effect = OSError("File not found")

        mock_path_instance = mock.MagicMock()
        mock_path_class.return_value = mock_path_instance
        mock_path_instance.exists.return_value = False

        response = client.get("/api/author-mappings", params={"config_path": "."})
        assert response.status_code == 500

    @mock.patch("gitlab_downloader.api_routes.AuthorMapper")
    def test_author_mappings_write_error(
        self, mock_mapper_class: mock.MagicMock, client: TestClient
    ) -> None:
        """Test error handling when saving author mappings fails."""
        mock_mapper = mock.MagicMock()
        mock_mapper_class.return_value = mock_mapper
        mock_mapper.load_mappings.side_effect = FileNotFoundError()
        mock_mapper.save_mappings.side_effect = OSError("Permission denied")

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
