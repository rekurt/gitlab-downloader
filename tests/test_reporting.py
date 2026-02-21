from __future__ import annotations

import json
from pathlib import Path

from gitlab_downloader.models import CloneResult, GitlabConfig
from gitlab_downloader.reporting import print_dry_run, print_summary, write_json_report


def make_config(tmp_path: Path, **overrides) -> GitlabConfig:
    data = {
        "url": "https://gitlab.example.com",
        "token": "test-token",
        "group": "my-group",
        "clone_path": str(tmp_path / "repositories"),
        "per_page": 100,
        "request_timeout": 30,
        "max_retries": 3,
        "clone_retries": 1,
        "max_concurrency": 5,
        "dry_run": False,
        "update_existing": False,
        "log_level": "INFO",
        "log_file": None,
        "interactive": False,
        "report_json": None,
        "auth_method": "token",
        "git_auth_mode": "url",
        "oauth_client_id": None,
        "oauth_client_secret": None,
        "oauth_scope": "read_api read_repository",
        "oauth_cache_path": ".tmp-oauth-cache.json",
    }
    data.update(overrides)
    return GitlabConfig(**data)


# --- print_summary ---


class TestPrintSummary:
    def test_no_failures_returns_false(self):
        results = [
            CloneResult(name="repo-a", status="success", message="ok"),
            CloneResult(name="repo-b", status="updated", message="ok"),
            CloneResult(name="repo-c", status="skipped", message="already exists"),
        ]
        assert print_summary(results) is False

    def test_with_failures_returns_true(self):
        results = [
            CloneResult(name="repo-a", status="success", message="ok"),
            CloneResult(name="repo-b", status="failed", message="auth error"),
        ]
        assert print_summary(results) is True

    def test_all_failures_returns_true(self):
        results = [
            CloneResult(name="repo-x", status="failed", message="timeout"),
            CloneResult(name="repo-y", status="failed", message="404"),
        ]
        assert print_summary(results) is True

    def test_empty_results_returns_false(self):
        assert print_summary([]) is False

    def test_logs_summary_counts(self, caplog):
        results = [
            CloneResult(name="a", status="success", message="ok"),
            CloneResult(name="b", status="updated", message="ok"),
            CloneResult(name="c", status="skipped", message="skip"),
            CloneResult(name="d", status="failed", message="err"),
        ]
        with caplog.at_level("INFO", logger="gitlab_downloader"):
            print_summary(results)

        summary_msgs = [r.message for r in caplog.records if "Summary" in r.message]
        assert len(summary_msgs) == 1
        assert "success=1" in summary_msgs[0]
        assert "updated=1" in summary_msgs[0]
        assert "skipped=1" in summary_msgs[0]
        assert "failed=1" in summary_msgs[0]

    def test_logs_failed_repos(self, caplog):
        results = [
            CloneResult(name="repo-bad", status="failed", message="connection refused"),
        ]
        with caplog.at_level("ERROR", logger="gitlab_downloader"):
            print_summary(results)

        error_msgs = [r.message for r in caplog.records if r.levelname == "ERROR"]
        assert any("repo-bad" in m for m in error_msgs)


# --- write_json_report ---


class TestWriteJsonReport:
    def test_creates_report_file(self, tmp_path):
        config = make_config(tmp_path)
        results = [
            CloneResult(name="repo-a", status="success", message="ok"),
        ]
        report_path = str(tmp_path / "report.json")

        write_json_report(report_path, config, 5, results)

        assert Path(report_path).exists()

    def test_report_json_structure(self, tmp_path):
        config = make_config(tmp_path)
        results = [
            CloneResult(name="repo-a", status="success", message="cloned"),
            CloneResult(name="repo-b", status="failed", message="timeout"),
        ]
        report_path = str(tmp_path / "report.json")

        write_json_report(report_path, config, 10, results)

        data = json.loads(Path(report_path).read_text())

        assert "generated_at" in data
        assert data["group"] == "my-group"
        assert data["projects_count"] == 10
        assert data["summary"]["success"] == 1
        assert data["summary"]["failed"] == 1
        assert data["summary"]["updated"] == 0
        assert data["summary"]["skipped"] == 0
        assert len(data["results"]) == 2
        assert data["results"][0]["name"] == "repo-a"
        assert data["results"][0]["status"] == "success"
        assert data["results"][1]["name"] == "repo-b"
        assert data["results"][1]["status"] == "failed"

    def test_creates_parent_directories(self, tmp_path):
        config = make_config(tmp_path)
        results = []
        report_path = str(tmp_path / "nested" / "dir" / "report.json")

        write_json_report(report_path, config, 0, results)

        assert Path(report_path).exists()
        data = json.loads(Path(report_path).read_text())
        assert data["projects_count"] == 0
        assert data["results"] == []

    def test_empty_results(self, tmp_path):
        config = make_config(tmp_path)
        report_path = str(tmp_path / "empty.json")

        write_json_report(report_path, config, 0, [])

        data = json.loads(Path(report_path).read_text())
        assert data["summary"] == {"success": 0, "updated": 0, "skipped": 0, "failed": 0}
        assert data["results"] == []

    def test_generated_at_is_iso_format(self, tmp_path):
        config = make_config(tmp_path)
        report_path = str(tmp_path / "report.json")

        write_json_report(report_path, config, 0, [])

        data = json.loads(Path(report_path).read_text())
        # Should be a valid ISO timestamp with timezone info
        ts = data["generated_at"]
        assert "T" in ts
        assert ts.endswith("+00:00") or ts.endswith("Z")


# --- print_dry_run ---


class TestPrintDryRun:
    def test_prints_project_info(self, tmp_path, caplog):
        config = make_config(tmp_path)
        projects = [
            {
                "id": 42,
                "name": "my-repo",
                "group_path": "my-group",
                "http_url_to_repo": "https://gitlab.example.com/my-group/my-repo.git",
            },
        ]

        def fake_build_clone_target(project, cfg):
            return project["name"], f"/target/{project['name']}"

        with caplog.at_level("INFO", logger="gitlab_downloader"):
            print_dry_run(projects, config, fake_build_clone_target)

        log_text = "\n".join(r.message for r in caplog.records)
        assert "42" in log_text
        assert "my-repo" in log_text
        assert "/target/my-repo" in log_text

    def test_prints_count(self, tmp_path, caplog):
        config = make_config(tmp_path)
        projects = [
            {"id": 1, "name": "a", "group_path": "", "http_url_to_repo": ""},
            {"id": 2, "name": "b", "group_path": "", "http_url_to_repo": ""},
            {"id": 3, "name": "c", "group_path": "", "http_url_to_repo": ""},
        ]

        def fake_build(p, c):
            return p["name"], f"/t/{p['name']}"

        with caplog.at_level("INFO", logger="gitlab_downloader"):
            print_dry_run(projects, config, fake_build)

        log_text = "\n".join(r.message for r in caplog.records)
        assert "Projects to process: 3" in log_text

    def test_empty_projects(self, tmp_path, caplog):
        config = make_config(tmp_path)

        def fake_build(p, c):
            return "", ""

        with caplog.at_level("INFO", logger="gitlab_downloader"):
            print_dry_run([], config, fake_build)

        log_text = "\n".join(r.message for r in caplog.records)
        assert "Projects to process: 0" in log_text

    def test_truncates_long_values(self, tmp_path, caplog):
        config = make_config(tmp_path)
        long_name = "x" * 100
        long_url = "https://gitlab.example.com/" + "a" * 200
        projects = [
            {
                "id": 99,
                "name": long_name,
                "group_path": "g",
                "http_url_to_repo": long_url,
            },
        ]

        def fake_build(p, c):
            return p["name"], "/target"

        with caplog.at_level("INFO", logger="gitlab_downloader"):
            print_dry_run(projects, config, fake_build)

        log_text = "\n".join(r.message for r in caplog.records)
        # Full long values should not appear (truncated to 30/45 chars)
        assert long_name not in log_text
        assert long_url not in log_text
        # Truncated prefix and project ID should appear
        assert "x" * 30 in log_text
        assert "99" in log_text
