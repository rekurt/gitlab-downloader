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
gitlab-dump --help
gitlab-dump --version
gitlab-dump --url https://gitlab.com --token <token> --group <group>
gitlab-dump --url https://gitlab.com --token <token>
gitlab-dump --dry-run --url https://gitlab.com --token <token> --group <group>
gitlab-dump --update --url https://gitlab.com --token <token> --group <group>
```

### OAuth Device Flow
```bash
gitlab-dump \
  --url https://gitlab.com \
  --auth-method oauth \
  --oauth-client-id <client_id> \
  --git-auth-mode credential_helper
```
CLI покажет ссылку и код для входа в браузере, затем сохранит access/refresh token в кэш (`~/.config/gitlab-dump/oauth_token.json` по умолчанию).

### Git Credential Helper
Для `clone/pull` без токена в URL:
```bash
gitlab-dump \
  --url https://gitlab.com \
  --auth-method token \
  --token <token> \
  --git-auth-mode credential_helper
```
В этом режиме используются `git credential approve` и настроенный `credential.helper`.

## Графический интерфейс (GUI)

`Gitlab Downloader` поставляется с кроссплатформенным графическим интерфейсом на базе Electron и React для управления загрузкой репозиториев и миграцией данных.

### Функциональность GUI
- Визуальное управление конфигурацией GitLab подключения
- Просмотр и выбор репозиториев для клонирования
- Отслеживание прогресса загрузки в реальном времени
- Миграция репозиториев между экземплярами GitLab
- Маппирование авторов при миграции
- Просмотр логов и отчётов операций

### Запуск GUI

Запустить приложение в режиме разработки:
```bash
cd electron
npm install
npm run dev
```

Запустить собранное приложение:
```bash
cd electron
npm start
```

### Сборка GUI

Создать портативное приложение для вашей платформы:
```bash
cd electron
npm run dist
```

Собрать для конкретной платформы:
```bash
npm run dist-mac      # для macOS
npm run dist-win      # для Windows
npm run dist-linux    # для Linux
```

Скомпилированные приложения будут в директории `electron/dist/`.

Требования для сборки:
- Node.js 16+
- npm или yarn
- Python 3.10+ (для встроенного Python бекенда)

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

Для использования GUI (графический интерфейс):
- Node.js 16+
- npm или yarn
