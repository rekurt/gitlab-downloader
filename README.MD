# Gitlab Downloader

Язык: **Русский (основной)** | [English](README.en.md)

`Gitlab Downloader` — асинхронная утилита для получения и клонирования всех репозиториев из GitLab-группы и её подгрупп с сохранением структуры директорий.

## Возможности
- Рекурсивный обход групп и подгрупп.
- Асинхронное клонирование с ограничением конкурентности.
- Retry для API и `git clone`.
- Итоговый отчёт (`success`, `updated`, `skipped`, `failed`).
- `--dry-run` для проверки без клонирования.
- `--update` для `git pull --ff-only` в уже существующих репозиториях.

## Установка
```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/pip install -e .[dev]
```

или:

```bash
make install
```

## Использование

Можно передавать параметры через CLI или через переменные окружения (`GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_GROUP`, `CLONE_PATH`).

```bash
python fetch_repositories.py --help
python fetch_repositories.py --url https://gitlab.com --token <token> --group <group>
python fetch_repositories.py --dry-run --url https://gitlab.com --token <token> --group <group>
python fetch_repositories.py --update --url https://gitlab.com --token <token> --group <group>
```

## Docker
```bash
docker build -t fetch-repositories .
docker run --rm \
  -e GITLAB_URL=https://gitlab.com \
  -e GITLAB_TOKEN=<token> \
  -e GITLAB_GROUP=<group> \
  -e CLONE_PATH=/app/repositories \
  -v $(pwd)/repositories:/app/repositories \
  fetch-repositories --dry-run
```

## Development
```bash
make lint
make format
make test
```

## Требования
- Python 3.10+
- Git
- Токен GitLab с правами `read_api` и `read_repository`
