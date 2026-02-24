# Gitlab Downloader

Язык: **Русский (основной)** | [English](README.en.md)

`Gitlab Downloader` — утилита для получения и клонирования всех репозиториев из GitLab-группы и её подгрупп с сохранением структуры директорий. Построена на Node.js.

## Возможности
- Рекурсивный обход групп и подгрупп.
- Клонирование с ограничением конкурентности.
- Retry для API и `git clone`.
- Итоговый отчёт (`success`, `updated`, `skipped`, `failed`).
- `--dry-run` для проверки без клонирования.
- `--update` для `git pull --ff-only` в уже существующих репозиториях.
- Интерактивный режим с визардами для клонирования и миграции.
- OAuth Device Flow для авторизации через браузер.
- Миграция авторов/коммитеров через git filter-branch.

## Установка

```bash
# Установить зависимости для всех компонентов (lib, cli, electron)
make node-install
```

или вручную:

```bash
npm install --prefix lib
npm install --prefix cli
npm install --prefix electron
```

## Использование

Можно передавать параметры через CLI или через переменные окружения (`GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_GROUP`, `CLONE_PATH`).
`GITLAB_GROUP` опционален: если не задан, будут загружены проекты текущего пользователя (membership).

```bash
node cli/bin/gitlab-dump.js --help
node cli/bin/gitlab-dump.js --version
node cli/bin/gitlab-dump.js --url https://gitlab.com --token <token> --group <group>
node cli/bin/gitlab-dump.js --url https://gitlab.com --token <token>
node cli/bin/gitlab-dump.js --dry-run --url https://gitlab.com --token <token> --group <group>
node cli/bin/gitlab-dump.js --update --url https://gitlab.com --token <token> --group <group>
```

Или через Makefile:
```bash
make cli-run
make cli-dry-run
```

### Интерактивный режим

```bash
node cli/bin/gitlab-dump.js --interactive          # Интерактивная настройка
node cli/bin/gitlab-dump.js --interactive-menu     # Полное интерактивное меню (клонирование/миграция)
```

### OAuth Device Flow
```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --auth-method oauth \
  --oauth-client-id <client_id> \
  --git-auth-mode credential_helper
```
CLI покажет ссылку и код для входа в браузере, затем сохранит access/refresh token в кэш (`~/.config/gitlab-dump/oauth_token.json` по умолчанию).

### Git Credential Helper
Для `clone/pull` без токена в URL:
```bash
node cli/bin/gitlab-dump.js \
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
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token> \
  --group my-group \
  --dry-run
```

Вывод покажет список всех репозиториев, которые будут клонированы, включая размер и последний commit.

### Обновление существующих репозиториев
Если репозитории уже клонированы ранее, используйте `--update` для получения последних изменений:

```bash
node cli/bin/gitlab-dump.js \
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
node cli/bin/gitlab-dump.js \
  --url https://gitlab.internal.company.com \
  --token <private-token> \
  --group engineering \
  --clone-path ./internal-repos
```

### Экспорт проектов текущего пользователя
Если вам не нужна группа, экспортируйте только проекты, к которым вы имеете доступ:

```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token> \
  --clone-path ./my-projects
```

### OAuth с Git credential helper
Современный способ без явного токена в аргументах:

```bash
# Первый запуск — будет предложен вход через браузер
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --auth-method oauth \
  --oauth-client-id <client_id> \
  --git-auth-mode credential_helper \
  --group frontend-team

# Последующие запуски используют сохранённый token
node cli/bin/gitlab-dump.js \
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

node cli/bin/gitlab-dump.js --dry-run
node cli/bin/gitlab-dump.js --update
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

Затем:

```bash
node cli/bin/gitlab-dump.js --update
```

### Batch обработка с логированием
Для automated процессов сохраняйте logs и отчёты:

```bash
mkdir -p logs/$(date +%Y-%m-%d)
node cli/bin/gitlab-dump.js \
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
node cli/bin/gitlab-dump.js \
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

`Gitlab Downloader` поставляется с кроссплатформенным графическим интерфейсом на базе Electron и React для управления загрузкой репозиториев и миграцией данных. GUI использует общую библиотеку `lib/` напрямую через IPC, без внешнего серверного процесса.

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

Скомпилированные приложения будут в директории `electron/dist_electron/`.

Требования для сборки:
- Node.js 16+
- npm

## Локальная разработка

### Настройка среды разработки

```bash
# Установить зависимости всех Node.js пакетов
make node-install
```

### Запуск компонентов

Терминал 1 — GUI:
```bash
cd electron
npm run dev
```
GUI будет открыта с горячей перезагрузкой при изменении кода.

Терминал 2 — CLI:
```bash
node cli/bin/gitlab-dump.js --help
node cli/bin/gitlab-dump.js --url https://gitlab.com --token <token> --group my-group
```

### Проверка кода и тесты

Запуск линтера:
```bash
make node-lint
```

Запуск тестов:
```bash
make node-test
```

Запуск CI pipeline:
```bash
make node-ci
```

### Общий рабочий процесс разработчика

1. Создать новую ветку для фичи:
```bash
git checkout -b feature/my-feature
```

2. Установить зависимости:
```bash
make node-install
```

3. Запустить компоненты:
   - GUI: `cd electron && npm run dev`
   - CLI: `node cli/bin/gitlab-dump.js ...` с нужными параметрами

4. Внести изменения в код и проверить их:
```bash
make node-lint      # проверить синтаксис
make node-test      # запустить тесты
```

5. Создать коммит:
```bash
git add .
git commit -m "feat: описание изменения"
```

6. Создать Pull Request и дождаться approval.

### Troubleshooting

**GUI не запускается**
- Убедитесь, что Node.js 16+ установлен: `node --version`
- Проверьте, что npm зависимости установлены: `make node-install`
- Очистите кэш npm: `npm cache clean --force`
- Удалите `node_modules` и переустановите: `make clean && make node-install`

**CLI команды не работают**
- Проверьте, что зависимости установлены: `npm install --prefix cli`
- Используйте `node cli/bin/gitlab-dump.js --help` для справки

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
make node-lint
make node-test
make node-ci
```

## Сборка бинарников

### Electron приложение
```bash
make electron-build
```

Артефакты: `electron/dist_electron/` с платформенно-специфичными инсталляторами.

Для разных ОС нужно собирать на соответствующей ОС (Linux на Linux, macOS на macOS, Windows на Windows). Для автоматизации используйте CI matrix.

## Требования
- Node.js 16+
- Git
- Токен GitLab с правами `read_api` и `read_repository`
