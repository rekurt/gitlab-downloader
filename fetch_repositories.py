import asyncio
import os
import sys
import tempfile
from dataclasses import dataclass
from typing import Dict, List, Optional

import aiohttp
from dotenv import load_dotenv

load_dotenv()


@dataclass
class GitlabConfig:
    url: str
    token: str
    group: str
    clone_path: str = "repositories"
    per_page: int = 100
    request_timeout: int = 30
    max_retries: int = 3
    max_concurrency: int = 5


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Missing required environment variable: {name}")
        sys.exit(1)
    return value


def trim_prefix(value: str, prefix: str) -> str:
    normalized_value = value.strip("/")
    normalized_prefix = prefix.strip("/")
    if normalized_value.startswith(normalized_prefix):
        return normalized_value[len(normalized_prefix):].strip("/")
    return normalized_value


async def fetch_json(
    session: aiohttp.ClientSession,
    url: str,
    params: Dict[str, str],
    description: str,
    config: GitlabConfig,
) -> Optional[List[Dict]]:
    delay = 1
    for attempt in range(1, config.max_retries + 1):
        try:
            async with session.get(url, params=params, timeout=config.request_timeout) as response:
                if response.status == 429 or response.status >= 500:
                    text = await response.text()
                    print(f"[warn] {description} attempt {attempt} failed with {response.status}: {text[:200]}")
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 10)
                    continue

                if response.status != 200:
                    text = await response.text()
                    print(f"[error] Failed to fetch {description}: {response.status} {text[:200]}")
                    return None

                return await response.json()
        except asyncio.TimeoutError:
            print(f"[warn] Timeout fetching {description} (attempt {attempt}). Retrying...")
        except Exception as exc:
            print(f"[warn] Error fetching {description} (attempt {attempt}): {exc}")

        await asyncio.sleep(delay)
        delay = min(delay * 2, 10)

    print(f"[error] Giving up on {description} after {config.max_retries} attempts.")
    return None


async def fetch_paginated(
    session: aiohttp.ClientSession,
    url: str,
    base_params: Dict[str, str],
    description: str,
    config: GitlabConfig,
) -> List[Dict]:
    page = 1
    results: List[Dict] = []

    while True:
        params = {**base_params, "per_page": str(config.per_page), "page": str(page)}
        data = await fetch_json(session, url, params, f"{description} page {page}", config)
        if data is None:
            break
        if not data:
            break

        results.extend(data)
        if len(data) < config.per_page:
            break

        page += 1

    return results


async def fetch_group_metadata(session: aiohttp.ClientSession, config: GitlabConfig) -> Dict:
    url = f"{config.url}/api/v4/groups/{config.group}"
    data = await fetch_json(session, url, {}, "group metadata", config)
    if data is None:
        print("[error] Unable to fetch group metadata. Check GITLAB_GROUP and token permissions.")
        sys.exit(1)
    return data


def extract_group_path(root_full_path: str, path_with_namespace: str) -> str:
    parent = path_with_namespace.rsplit("/", 1)[0] if "/" in path_with_namespace else ""
    return trim_prefix(parent, root_full_path)


async def get_all_projects(
    session: aiohttp.ClientSession,
    config: GitlabConfig,
    root_full_path: str,
) -> List[Dict]:
    base_url = f"{config.url}/api/v4/groups"
    projects: List[Dict] = []

    to_visit: List[Dict] = [{"id": config.group, "full_path": root_full_path}]

    while to_visit:
        current = to_visit.pop()
        group_id = current["id"]
        group_path = current["full_path"]
        print(f"[info] Fetching projects for group {group_path} ({group_id})...")

        project_items = await fetch_paginated(
            session,
            f"{base_url}/{group_id}/projects",
            {"include_subgroups": "false"},
            f"projects for group {group_path}",
            config,
        )

        for project in project_items:
            path_with_namespace = project.get("path_with_namespace", "")
            project["group_path"] = extract_group_path(root_full_path, path_with_namespace)
            projects.append(project)

        subgroups = await fetch_paginated(
            session,
            f"{base_url}/{group_id}/subgroups",
            {},
            f"subgroups for group {group_path}",
            config,
        )

        for subgroup in subgroups:
            subgroup_id = subgroup["id"]
            subgroup_path = subgroup.get("full_path") or subgroup.get("path") or str(subgroup_id)
            subgroup_relative = trim_prefix(subgroup_path, root_full_path)
            to_visit.append({"id": subgroup_id, "full_path": subgroup_relative})

    return projects


def sanitize_path_component(value: str) -> str:
    return value.replace("\\", "/").strip("/").replace("..", "")


async def clone_repository(project: Dict, config: GitlabConfig, semaphore: asyncio.Semaphore) -> None:
    async with semaphore:
        repo_name = sanitize_path_component(project["name"])
        group_path = sanitize_path_component(project["group_path"])
        path_parts = [config.clone_path] + ([*group_path.split("/")] if group_path else []) + [repo_name]
        full_clone_path = os.path.join(*path_parts)
        https_url = project.get("http_url_to_repo")

        if not https_url:
            print(f"[warn] Skipping {repo_name}: HTTPS URL is missing.")
            return

        os.makedirs(os.path.dirname(full_clone_path), exist_ok=True)

        if os.path.exists(full_clone_path):
            print(f"[info] Skipping {repo_name}: already cloned.")
            return

        fd, askpass_path = tempfile.mkstemp(prefix="gitlab_askpass_", text=True)
        with os.fdopen(fd, "w") as handle:
            handle.write(
                "#!/bin/sh\n"
                'case "$1" in\n'
                "*sername*) echo \"oauth2\";;\n"
                "*assword*) echo \"" + config.token + "\";;\n"
                "*) echo \"\";;\n"
                "esac\n"
            )
        os.chmod(askpass_path, 0o700)

        env = {
            **os.environ,
            "GIT_ASKPASS": askpass_path,
            "GIT_TERMINAL_PROMPT": "0",
        }

        print(f"[info] Cloning {repo_name} from {https_url} into {full_clone_path}...")

        try:
            process = await asyncio.create_subprocess_exec(
                "git",
                "clone",
                https_url,
                full_clone_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await process.communicate()

            if process.returncode == 0:
                print(f"[info] Repository {repo_name} cloned successfully.")
            else:
                print(f"[error] Failed to clone {repo_name}: {stderr.decode().strip()}")
        finally:
            try:
                os.remove(askpass_path)
            except OSError:
                pass


async def clone_all_repositories(projects: List[Dict], config: GitlabConfig) -> None:
    semaphore = asyncio.Semaphore(config.max_concurrency)
    tasks = [clone_repository(project, config, semaphore) for project in projects]
    await asyncio.gather(*tasks)


async def main() -> None:
    gitlab_url = require_env("GITLAB_URL")
    gitlab_token = require_env("GITLAB_TOKEN")
    group_id = require_env("GITLAB_GROUP")
    clone_path = os.getenv("CLONE_PATH", "repositories")

    config = GitlabConfig(
        url=gitlab_url,
        token=gitlab_token,
        group=group_id,
        clone_path=clone_path,
    )

    headers = {"Authorization": f"Bearer {config.token}"}

    async with aiohttp.ClientSession(headers=headers) as session:
        group_meta = await fetch_group_metadata(session, config)
        root_full_path = group_meta.get("full_path", str(group_meta.get("path", config.group)))

        print("[info] Fetching repository list...")
        projects = await get_all_projects(session, config, root_full_path)

    print(f"[info] Found {len(projects)} repositories.")
    for project in projects:
        group_path = project["group_path"]
        print(f"[info] ID: {project['id']} | Name: {project['name']} | Group Path: {group_path} | URL: {project['web_url']}")

    print("[info] Starting clone...")
    await clone_all_repositories(projects, config)
    print("[info] Done.")


if __name__ == "__main__":
    asyncio.run(main())
