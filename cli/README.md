# gitlab-dump-cli

Консольный интерфейс (CLI) для загрузки репозиториев GitLab и миграции данных. Использует общую библиотеку `@gitlab-dump/core` (`lib/`).

## Установка

```bash
npm install --prefix cli
```

Или из корня проекта:
```bash
make node-install
```

## Использование

### Основные команды

```bash
node cli/bin/gitlab-dump.js --help                # Справка
node cli/bin/gitlab-dump.js --version             # Версия
```

### Клонирование репозиториев

```bash
# Клонирование всех репозиториев группы
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token> \
  --group <group>

# Только проекты текущего пользователя (без --group)
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token>

# Предварительный просмотр без клонирования
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token> \
  --group <group> \
  --dry-run

# Обновление уже клонированных репозиториев (git pull --ff-only)
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --token <token> \
  --group <group> \
  --update
```

Или через Makefile:
```bash
make cli-run
make cli-dry-run
```

### Интерактивный режим

```bash
# Интерактивная настройка параметров
node cli/bin/gitlab-dump.js --interactive

# Полное интерактивное меню (клонирование, миграция, история)
node cli/bin/gitlab-dump.js --interactive-menu
```

### OAuth Device Flow

```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --auth-method oauth \
  --oauth-client-id <client_id> \
  --git-auth-mode credential_helper
```

CLI покажет ссылку и код для входа в браузере, затем сохранит токены в кэш (`~/.config/gitlab-dump/oauth_token.json`).

### Git Credential Helper

Клонирование без токена в URL:

```bash
node cli/bin/gitlab-dump.js \
  --url https://gitlab.com \
  --auth-method token \
  --token <token> \
  --git-auth-mode credential_helper
```

## Параметры командной строки

| Параметр | Описание | По умолчанию |
|----------|----------|-------------|
| `--url` | URL GitLab-инстанса | `GITLAB_URL` или `https://gitlab.com` |
| `--token` | Personal access token | `GITLAB_TOKEN` |
| `--group` | ID или путь группы | `GITLAB_GROUP` (опционально) |
| `--clone-path` | Директория для клонов | `CLONE_PATH` или `./repositories` |
| `--auth-method` | Метод аутентификации (`token`, `oauth`) | `token` |
| `--oauth-client-id` | OAuth Client ID | `GITLAB_OAUTH_CLIENT_ID` |
| `--git-auth-mode` | Режим git-аутентификации (`url`, `credential_helper`) | `url` |
| `--dry-run` | Только показать список, не клонировать | — |
| `--update` | Обновить существующие репозитории | — |
| `--interactive` | Интерактивный ввод параметров | — |
| `--interactive-menu` | Полное интерактивное меню | — |

Все параметры можно задать через переменные окружения или файл `.env`.

## Структура

```
cli/
├── bin/
│   └── gitlab-dump.js    # Точка входа CLI
├── index.js              # Основная логика (парсинг аргументов, workflow)
├── ui.js                 # Терминальный UI (промпты, таблицы, цвета)
├── package.json          # Зависимости
└── __tests__/            # Jest-тесты
```

## Модули

### bin/gitlab-dump.js
Точка входа — вызывает `main()` из `index.js` и обрабатывает exit code.

### index.js
Основная логика CLI:
- Парсинг аргументов через `commander`
- Загрузка конфигурации из аргументов, переменных окружения и `.env`
- Workflow клонирования: получение проектов → клонирование → отчёт
- Workflow миграции через интерактивное меню
- Интерактивный режим настройки

### ui.js
Терминальный интерфейс:
- Интерактивные промпты через `inquirer` (ленивая загрузка)
- Цветной вывод через `chalk`
- Главное меню, меню клонирования, визард миграции
- Функции `showSuccess`, `showError`, `showWarning`, `showInfo`

## Тестирование

```bash
npm test --prefix cli
```

Или из корня проекта:
```bash
make cli-test
```

## Зависимости

- **@gitlab-dump/core** — общая core-библиотека
- **commander** — парсинг аргументов командной строки
- **inquirer** — интерактивные промпты
- **chalk** — цветной вывод в терминале
- **dotenv** — загрузка переменных окружения

## Лицензия

MIT
