"""Integration tests for backend-frontend communication.

These tests exercise actual HTTP calls via FastAPI TestClient to verify
endpoint contracts at runtime, rather than testing static dictionaries.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from gitlab_downloader.api import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Create a test client for the FastAPI app.

    Clears GITLAB_DUMP_API_TOKEN to ensure tests that don't explicitly set
    a token are not affected by ambient environment variables.
    """
    monkeypatch.delenv("GITLAB_DUMP_API_TOKEN", raising=False)
    app = create_app()
    return TestClient(app)


class TestAPIServerInitialization:
    """Test API server initialization and configuration."""

    def test_api_server_creates_app(self) -> None:
        """Test that API server can be created."""
        app = create_app()
        assert app is not None
        assert app.title == "GitLab Dump API"
        assert app.version == "0.1.0"

    def test_api_server_has_cors_middleware(self) -> None:
        """Test that CORS middleware is configured."""
        app = create_app()
        # Check that middleware is added (CORS middleware is the first one)
        assert len(app.user_middleware) > 0, "No middleware configured"

    def test_api_server_routes_registered(self) -> None:
        """Test that all required routes are registered."""
        app = create_app()
        routes = {str(getattr(route, "path", "")) for route in app.routes if hasattr(route, "path")}
        required_routes = {
            "/api/status",
            "/api/repos",
            "/api/author-mappings",
            "/api/migrate",
        }
        assert required_routes.issubset(routes)


class TestFrontendBackendCommunication:
    """Test communication via real HTTP calls to FastAPI."""

    def test_get_status_endpoint(self, client: TestClient) -> None:
        """Test GET /api/status returns valid response."""
        response = client.get("/api/status")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert isinstance(data["version"], str)

    def test_get_repositories_endpoint(self, client: TestClient) -> None:
        """Test GET /api/repos returns valid response with correct schema."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a fake git repo
            repo_dir = Path(tmpdir) / "my-repo"
            repo_dir.mkdir()
            git_dir = repo_dir / ".git"
            git_dir.mkdir()
            config = git_dir / "config"
            config.write_text('[remote "origin"]\n\turl = https://gitlab.com/group/repo.git\n')

            response = client.get("/api/repos", params={"clone_path": tmpdir})
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data["total"], int)
            assert isinstance(data["repositories"], list)
            assert data["total"] == 1
            repo = data["repositories"][0]
            assert "name" in repo
            assert "path" in repo
            assert "url" in repo
            assert "last_updated" in repo
            assert repo["name"] == "my-repo"
            assert repo["url"] == "https://gitlab.com/group/repo.git"

    def test_get_repositories_empty_dir(self, client: TestClient) -> None:
        """Test GET /api/repos returns empty list for directory without repos."""
        with tempfile.TemporaryDirectory() as tmpdir:
            response = client.get("/api/repos", params={"clone_path": tmpdir})
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 0
            assert data["repositories"] == []

    @patch("gitlab_downloader.api_routes.MigrationExecutor")
    @patch("gitlab_downloader.api_routes.asyncio.create_task")
    def test_migrate_endpoint_roundtrip(
        self,
        mock_create_task: MagicMock,
        mock_executor: MagicMock,
        tmp_path: Path,
        client: TestClient,
    ) -> None:
        """Test POST /api/migrate and GET /api/migration-progress roundtrip."""
        migration_request = {
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

        # Start migration
        start_response = client.post("/api/migrate", json=migration_request)
        assert start_response.status_code == 200
        start_data = start_response.json()
        assert "migration_id" in start_data
        migration_id = start_data["migration_id"]
        assert isinstance(migration_id, str)
        assert len(migration_id) > 0

        # Check progress
        progress_response = client.get(f"/api/migration-progress/{migration_id}")
        assert progress_response.status_code == 200
        progress_data = progress_response.json()
        assert progress_data["migration_id"] == migration_id
        assert progress_data["status"] in ["pending", "running", "completed", "failed"]
        assert isinstance(progress_data["progress"], int)
        assert 0 <= progress_data["progress"] <= 100
        assert isinstance(progress_data["messages"], list)

    def test_migration_progress_not_found(self, client: TestClient) -> None:
        """Test GET /api/migration-progress returns 404 for unknown ID."""
        response = client.get("/api/migration-progress/nonexistent-id")
        assert response.status_code == 404

    def test_author_mappings_get_empty(self, client: TestClient) -> None:
        """Test GET /api/author-mappings returns empty when no config exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            response = client.get("/api/author-mappings", params={"config_path": tmpdir})
            assert response.status_code == 200
            data = response.json()
            assert data == {}


class TestAPITokenProtection:
    """Test API token protection for mutating endpoints."""

    def test_post_without_token_when_token_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that POST requests are rejected without valid API token."""
        monkeypatch.setenv("GITLAB_DUMP_API_TOKEN", "test-secret-token")
        app = create_app()
        token_client = TestClient(app)

        response = token_client.post(
            "/api/migrate",
            json={
                "repo_path": "/tmp/test",
                "author_mappings": {},
                "committer_mappings": {},
            },
        )
        assert response.status_code == 403
        assert "Invalid or missing API token" in response.json()["detail"]

    def test_post_with_valid_token(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Test that POST requests succeed with valid API token."""
        monkeypatch.setenv("GITLAB_DUMP_API_TOKEN", "test-secret-token")
        app = create_app()
        token_client = TestClient(app)

        with patch("gitlab_downloader.api_routes.MigrationExecutor"):
            with patch("gitlab_downloader.api_routes.asyncio.create_task"):
                response = token_client.post(
                    "/api/migrate",
                    json={
                        "repo_path": str(tmp_path),
                        "author_mappings": {},
                        "committer_mappings": {},
                    },
                    headers={"X-API-Token": "test-secret-token"},
                )
        assert response.status_code == 200

    def test_get_requests_require_token(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that GET requests also require API token."""
        monkeypatch.setenv("GITLAB_DUMP_API_TOKEN", "test-secret-token")
        app = create_app()
        token_client = TestClient(app)

        # GET without token should be rejected
        response = token_client.get("/api/status")
        assert response.status_code == 403

        # GET with correct token should succeed
        response = token_client.get(
            "/api/status", headers={"X-API-Token": "test-secret-token"}
        )
        assert response.status_code == 200

    def test_no_token_env_allows_all(
        self, tmp_path: Path, client: TestClient
    ) -> None:
        """Test that without GITLAB_DUMP_API_TOKEN env, all requests pass."""
        with patch("gitlab_downloader.api_routes.MigrationExecutor"):
            with patch("gitlab_downloader.api_routes.asyncio.create_task"):
                response = client.post(
                    "/api/migrate",
                    json={
                        "repo_path": str(tmp_path),
                        "author_mappings": {},
                        "committer_mappings": {},
                    },
                )
        assert response.status_code == 200


class TestErrorHandling:
    """Test error handling in backend-frontend integration."""

    def test_repos_invalid_path_traversal(self, client: TestClient) -> None:
        """Test that path traversal is rejected."""
        response = client.get("/api/repos", params={"clone_path": "../../../etc"})
        assert response.status_code == 400

    def test_repos_nonexistent_path(self, client: TestClient) -> None:
        """Test that nonexistent path returns empty list, not error."""
        response = client.get(
            "/api/repos", params={"clone_path": "/tmp/nonexistent-path-12345"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
