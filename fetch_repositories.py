import os
import requests
import asyncio
from dotenv import load_dotenv

# Загрузка переменных из .env файла
load_dotenv()

def get_all_projects_in_group(gitlab_url, gitlab_token, group_id):
    """
    Рекурсивное получение всех проектов и подгрупп.
    """
    headers = {"Authorization": f"Bearer {gitlab_token}"}
    base_url = f"{gitlab_url}/api/v4/groups"
    projects = []

    def fetch_projects(group_id, group_path=""):
        # Получение проектов в группе
        print(f"Получение проектов группы с ID: {group_id}")
        response = requests.get(f"{base_url}/{group_id}/projects", headers=headers)

        if response.status_code == 200:
            for project in response.json():
                project['group_path'] = group_path
                projects.append(project)
        else:
            print(f"Ошибка получения проектов: {response.status_code} - {response.text}")

        # Получение подгрупп
        response = requests.get(f"{base_url}/{group_id}/subgroups", headers=headers)

        if response.status_code == 200:
            subgroups = response.json()
            for subgroup in subgroups:
                fetch_projects(subgroup['id'], f"{group_path}/{subgroup['name']}")
        else:
            print(f"Ошибка получения подгрупп: {response.status_code} - {response.text}")

    fetch_projects(group_id)
    return projects


async def clone_repository(project, clone_path):
    """
    Асинхронное клонирование репозитория.
    """
    repo_name = project['name']
    group_path = project['group_path'].strip('/')
    full_clone_path = os.path.join(clone_path, group_path, repo_name)
    https_url = project.get('http_url_to_repo')

    if not https_url:
        print(f"Пропущен репозиторий: {repo_name} (HTTPS URL недоступен)")
        return

    os.makedirs(os.path.dirname(full_clone_path), exist_ok=True)

    if os.path.exists(full_clone_path):
        print(f"Пропущен {repo_name}: уже клонирован.")
        return

    print(f"Клонирование {repo_name} из {https_url} в {full_clone_path}...")
    try:
        token = os.getenv("GITLAB_TOKEN")
        if not token:
            print("Ошибка: GITLAB_TOKEN не задан.")
            return

        auth_url = https_url.replace("https://", f"https://oauth2:{token}@")
        process = await asyncio.create_subprocess_exec(
            "git", "clone", auth_url, full_clone_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        if process.returncode == 0:
            print(f"Репозиторий {repo_name} успешно клонирован.")
        else:
            print(f"Ошибка клонирования {repo_name}:\n{stderr.decode()}")
    except Exception as e:
        print(f"Ошибка клонирования {repo_name}: {e}")


async def clone_all_repositories(projects, clone_path):
    """
    Асинхронное клонирование всех репозиториев.
    """
    tasks = [clone_repository(project, clone_path) for project in projects]
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    gitlab_url = os.getenv("GITLAB_URL")
    gitlab_token = os.getenv("GITLAB_TOKEN")
    clone_path = os.getenv("CLONE_PATH", "repositories")
    group_id = os.getenv("GITLAB_GROUP")

    if not gitlab_url or not gitlab_token or not group_id:
        print("Ошибка: Необходимо указать GITLAB_URL, GITLAB_TOKEN и GITLAB_GROUP.")
        exit(1)

    print("Получение списка репозиториев...")
    projects = get_all_projects_in_group(gitlab_url, gitlab_token, group_id)

    print(f"Найдено репозиториев: {len(projects)}")
    for project in projects:
        group_path = project['group_path'].strip('/')
        print(f"ID: {project['id']} | Name: {project['name']} | Group Path: {group_path} | URL: {project['web_url']}")

    print("Начало клонирования...")
    asyncio.run(clone_all_repositories(projects, clone_path))
    print("Готово.")
