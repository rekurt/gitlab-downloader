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

## Примеры использования

### Сухой запуск перед клонированием
Проверить, какие репозитории будут загружены без реального клонирования:

```bash
gitlab-dump \
  --url https://gitlab.com \
  --token <token> \
  --group my-group \
  --dry-run
```

Вывод покажет список всех репозиториев, которые будут клонированы, включая размер и последний commit.

### Обновление существующих репозиториев
Если репозитории уже клонированы ранее, используйте `--update` для получения последних изменений:

```bash
gitlab-dump \
  --url https://gitlab.com \
  --token <token> \
  --group my-group \
  --update \
  --clone-path ./repositories
```

Это выполнит `git pull --ff-only` для каждого репозитория вместо повторного клонирования.

### Синхронизация с приватного GitLab сервера
Клонирование репозиториев с приватного GitLab инстанса (например, корпоративный сервер):

```bash
gitlab-dump \
  --url https://gitlab.internal.company.com \
  --token <private-token> \
  --group engineering \
  --clone-path ./internal-repos
```

### Экспорт проектов текущего пользователя
Если вам не нужна группа, экспортируйте только проекты, к которым вы имеете доступ:

```bash
gitlab-dump \
  --url https://gitlab.com \
  --token <token> \
  --clone-path ./my-projects
```

### OAuth с Git credential helper
Современный способ без явного токена в аргументах:

```bash
# Первый запуск — будет предложен вход через браузер
gitlab-dump \
  --url https://gitlab.com \
  --auth-method oauth \
  --oauth-client-id <client_id> \
  --git-auth-mode credential_helper \
  --group frontend-team

# Последующие запуски используют сохранённый token
gitlab-dump \
  --url https://gitlab.com \
  --git-auth-mode credential_helper \
  --group frontend-team \
  --update
```

### Настройка через переменные окружения
Если вы часто клонируете одну и ту же группу, используйте переменные окружения:

```bash
export GITLAB_URL=https://gitlab.com
export GITLAB_TOKEN=glpat-xxxxxxxxxxxx
export GITLAB_GROUP=my-organization
export CLONE_PATH=/data/repositories

gitlab-dump --dry-run
gitlab-dump --update
```

### Файл .env конфигурации
Создайте `.env` файл в директории проекта:

```bash
# .env
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=glpat-your-token-here
GITLAB_GROUP=my-group
CLONE_PATH=./repositories
```

Затем в скрипте:

```bash
#!/bin/bash
source .env
gitlab-dump --update
```

### Batch обработка с логированием
Для automated процессов сохраняйте logs и отчёты:

```bash
mkdir -p logs/$(date +%Y-%m-%d)
gitlab-dump \
  --url https://gitlab.com \
  --token <token> \
  --group production \
  --update \
  --clone-path ./production-repos \
  > logs/$(date +%Y-%m-%d)/sync.log 2>&1

echo "Sync completed at $(date)" >> logs/sync_history.txt
```

### Миграция между GitLab инстансами
Клонирование из одного GitLab и подготовка к push в другой:

```bash
# Шаг 1: Клонировать исходные репозитории
gitlab-dump \
  --url https://old-gitlab.company.com \
  --token <old-token> \
  --group team \
  --clone-path ./migration-backup

# Шаг 2: Для каждого репозитория изменить remote и push
for repo in migration-backup/*/; do
  cd "$repo"
  git remote set-url origin https://new-gitlab.company.com/group/$(basename "$repo")
  git push --all origin
  git push --tags origin
  cd - > /dev/null
done
```

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

## Локальная разработка

### Настройка среды разработки

Для полной разработки проекта с CLI, REST API и Electron GUI необходимо:

1. Установить зависимости Python:
```bash
make install
```

2. Установить зависимости Electron/Node.js:
```bash
cd electron
npm install
cd ..
```

### Запуск всех компонентов

#### Вариант 1: В отдельных терминалах (рекомендуется)

Терминал 1 — Python REST API:
```bash
# Активировать виртуальное окружение (если необходимо)
source venv/bin/activate

# Запустить REST API на локальном сервере
python -m gitlab_downloader.api
```
API будет доступна по адресу: `http://localhost:8000`

Терминал 2 — Electron GUI (в режиме разработки):
```bash
cd electron
npm run dev
```
GUI будет открыта с горячей перезагрузкой при изменении кода.

Терминал 3 — Использование CLI:
```bash
# В основной директории проекта
gitlab-dump --help
gitlab-dump --url https://gitlab.com --token <token> --group my-group
```

#### Вариант 2: Запуск API в фоне

```bash
# Запустить API в фоне
python -m gitlab_downloader.api &

# Затем в том же терминале запустить GUI
cd electron
npm run dev

# Или использовать CLI
gitlab-dump --url https://gitlab.com --token <token> --group my-group
```

### Проверка кода и тесты

Запуск линтера:
```bash
make lint
```

Форматирование кода:
```bash
make format
```

Запуск тестов:
```bash
make test
```

Проверка покрытия кода тестами:
```bash
make coverage
```

### Общий рабочий процесс разработчика

1. Создать новую ветку для фичи:
```bash
git checkout -b feature/my-feature
```

2. Установить зависимости:
```bash
make install
cd electron && npm install && cd ..
```

3. Запустить компоненты (в отдельных терминалах):
   - REST API: `python -m gitlab_downloader.api`
   - GUI: `cd electron && npm run dev`
   - CLI: `gitlab-dump ...` с нужными параметрами

4. Внести изменения в код и проверить их:
```bash
make lint      # проверить синтаксис
make format    # форматировать код
make test      # запустить тесты
```

5. Создать коммит:
```bash
git add .
git commit -m "feat: описание изменения"
```

6. Создать Pull Request и дождаться approval.

### Troubleshooting

**API не запускается**
- Убедитесь, что Python 3.10+ установлен: `python --version`
- Проверьте, что виртуальное окружение активировано
- Проверьте, что зависимости установлены: `make install`

**GUI не запускается**
- Убедитесь, что Node.js 16+ установлен: `node --version`
- Проверьте, что npm зависимости установлены: `cd electron && npm install`
- Очистите кэш npm: `npm cache clean --force`
- Удалите `node_modules` и переустановите: `rm -rf node_modules && npm install`

**CLI команды не работают**
- Убедитесь, что пакет установлен в режиме разработки: `pip install -e .[dev]`
- Проверьте, что виртуальное окружение активировано
- Используйте `python -m gitlab_downloader.cli --help` для справки

**Проблемы с Git credentials при тестировании**
- Используйте реальные учётные данные только при локальном тестировании
- Для CI/CD используйте переменные окружения вместо явной передачи токенов

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
