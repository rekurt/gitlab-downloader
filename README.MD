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
`GITLAB_GROUP` опционален: если не задан, будут загружены проекты текущего пользователя (membership).

```bash
python fetch_repositories.py --help
python fetch_repositories.py --url https://gitlab.com --token <token> --group <group>
python fetch_repositories.py --url https://gitlab.com --token <token>
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

## Сборка бинарника
Быстрая локальная сборка (рекомендуется, `onedir`):
```bash
make binary
```

Упакованный единый файл (медленнее старт, `onefile`):
```bash
make binary_onefile
```

Артефакты:
- `onedir` (быстро): `dist/gitlab-dump/`
- `onefile` (удобно переносить):
  - macOS/Linux: `dist/gitlab-dump`
  - Windows: `dist/gitlab-dump.exe`

Очистка артефактов:
```bash
make binary_clean
```

Важно: `onefile` заметно медленнее на старте из-за распаковки. Для частого запуска используйте `make binary`. Для разных ОС нужно собирать на соответствующей ОС (Linux на Linux, macOS на macOS, Windows на Windows). Для автоматизации используйте CI matrix.

## Требования
- Python 3.10+
- Git
- Токен GitLab с правами `read_api` и `read_repository`
