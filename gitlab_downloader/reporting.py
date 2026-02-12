from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from .models import CloneResult, GitlabConfig

logger = logging.getLogger("gitlab_downloader")


def print_summary(results: list[CloneResult]) -> bool:
    success = sum(1 for item in results if item.status == "success")
    skipped = sum(1 for item in results if item.status == "skipped")
    failed = sum(1 for item in results if item.status == "failed")
    updated = sum(1 for item in results if item.status == "updated")

    logger.info(
        "Summary: success=%s updated=%s skipped=%s failed=%s",
        success,
        updated,
        skipped,
        failed,
    )

    if failed:
        logger.error("Failed repositories:")
        for item in results:
            if item.status == "failed":
                logger.error("- %s: %s", item.name, item.message)

    return failed > 0


def print_dry_run(projects: list[dict], config: GitlabConfig, build_clone_target) -> None:
    logger.info("Dry-run mode enabled. Projects to process: %s", len(projects))
    logger.info("%-8s %-30s %-30s %-45s %s", "ID", "NAME", "GROUP_PATH", "URL", "TARGET")

    for project in projects:
        repo_name, target_path = build_clone_target(project, config)
        url = str(project.get("http_url_to_repo", ""))[:45]
        logger.info(
            "%-8s %-30s %-30s %-45s %s",
            str(project.get("id", "")),
            repo_name[:30],
            str(project.get("group_path", ""))[:30],
            url,
            target_path,
        )


def write_json_report(
    path: str, config: GitlabConfig, projects_count: int, results: list[CloneResult]
) -> None:
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "group": config.group,
        "projects_count": projects_count,
        "summary": {
            "success": sum(1 for item in results if item.status == "success"),
            "updated": sum(1 for item in results if item.status == "updated"),
            "skipped": sum(1 for item in results if item.status == "skipped"),
            "failed": sum(1 for item in results if item.status == "failed"),
        },
        "results": [item.__dict__ for item in results],
    }

    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    logger.info("JSON report written to %s", output)
