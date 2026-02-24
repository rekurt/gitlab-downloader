# @gitlab-dump/core

Общая Node.js-библиотека для загрузки репозиториев GitLab и миграции данных. Используется как CLI-приложением (`cli/`), так и десктопным GUI (`electron/`).

## Обзор

Библиотека предоставляет модули для:
- Работы с GitLab API (пагинация, retry, rate limiting)
- Аутентификации (OAuth Device Flow, токен)
- Клонирования и обновления репозиториев с контролем конкурентности
- Миграции авторов/коммитеров через git filter-branch
- Валидации конфигурации через Zod
- Генерации отчётов

## Установка

```bash
npm install
```

Или из корня проекта:
```bash
make node-install
```

## Модули

### constants.js
Константы и значения по умолчанию:
- `GITLAB_API_VERSION` — версия API (`v4`)
- `DEFAULT_CLONE_PATH` — путь клонирования по умолчанию
- `DEFAULT_PER_PAGE`, `DEFAULT_TIMEOUT` — параметры пагинации и таймаутов
- `DEFAULT_API_RETRIES`, `DEFAULT_CLONE_RETRIES` — количество повторных попыток
- `DEFAULT_CONCURRENCY`, `MIN_CONCURRENCY`, `MAX_CONCURRENCY` — лимиты конкурентности
- `RETRY_BACKOFF_MAX` — максимальная задержка между повторами

### config.js
Валидация и загрузка конфигурации:
- `GitlabConfigSchema` — Zod-схема конфигурации
- `validateGitlabUrl(url)` — валидация URL GitLab-инстанса
- `loadConfigFromEnv()` — загрузка конфигурации из переменных окружения
- `parseConfig(raw)` — парсинг и валидация сырых данных конфигурации

### utils.js
Утилиты для работы с путями и URL:
- `trimPrefix(str, prefix)` — удаление префикса строки
- `sanitizePathComponent(name)` — безопасная обработка имён для путей
- `extractGroupPath(project, groupId)` — извлечение пути группы из проекта
- `isSubpath(parent, child)` — проверка вложенности путей
- `sanitizeGitOutput(output)` — очистка вывода git от чувствительных данных
- `buildAuthenticatedCloneUrl(url, token)` — сборка URL для клонирования с токеном

### client.js
Клиент GitLab API с поддержкой пагинации и retry:
- `maybeRateLimitDelay(headers)` — задержка при rate limit
- `fetchJson(url, options)` — запрос JSON с retry
- `fetchPaginated(url, options)` — пагинированный запрос всех страниц
- `fetchGroupMetadata(config)` — получение метаданных группы
- `getAllProjects(config)` — получение всех проектов группы
- `getUserProjects(config)` — получение проектов текущего пользователя

### auth.js
Аутентификация — OAuth Device Flow и токен:
- `readCache(path)` / `writeCache(path, data)` — чтение/запись кэша токенов
- `tokenValid(token)` — проверка валидности токена
- `cacheMatches(cache, config)` — проверка соответствия кэша конфигурации
- `normalizeOAuthPayload(payload)` — нормализация ответа OAuth
- `refreshAccessToken(config, refreshToken)` — обновление access token
- `deviceAuthorize(config)` — начало Device Flow авторизации
- `pollDeviceToken(config, deviceCode, interval)` — опрос статуса авторизации
- `resolveAccessToken(config)` — получение готового access token

### cloner.js
Клонирование и обновление git-репозиториев:
- `runGitCommand(args, options)` — выполнение git-команды
- `ensureCredentialsInHelper(config)` — сохранение credentials в git helper
- `resetCredentialState()` — сброс состояния credentials
- `buildCloneTarget(project, config)` — подготовка данных для клонирования
- `cloneRepository(target, config)` — клонирование одного репозитория
- `cloneAllRepositories(projects, config)` — клонирование всех с контролем конкурентности

### author-mapper.js
Маппинг авторов для миграции:
- `CONFIG_FILENAMES` — поддерживаемые имена файлов конфигурации
- `loadMappings(path)` — загрузка маппинга из JSON/YAML
- `saveMappings(path, mappings)` — сохранение маппинга
- `loadMigrationConfig(repoPath)` — загрузка конфигурации миграции из репозитория
- `saveMigrationConfig(repoPath, config)` — сохранение конфигурации миграции
- `discoverConfig(repoPath)` — автоматическое обнаружение конфигурации
- `saveConfigToRepo(repoPath, config)` — сохранение конфига в репозиторий
- `validateConfigData(data)` — валидация данных конфигурации

### migration.js
Миграция авторов/коммитеров через git filter-branch:
- `createMappingScript(mappings)` — генерация скрипта для filter-branch
- `MigrationExecutor` — класс для выполнения миграции с прогрессом и отменой

### reporting.js
Генерация отчётов:
- `printSummary(results)` — вывод итогового отчёта в консоль
- `printDryRun(projects, config)` — вывод dry-run отчёта
- `writeJsonReport(results, path)` — сохранение отчёта в JSON

## Использование

```javascript
import {
  loadConfigFromEnv,
  getAllProjects,
  cloneAllRepositories,
  printSummary,
} from '@gitlab-dump/core';

// Загрузка конфигурации
const config = loadConfigFromEnv();

// Получение списка проектов
const projects = await getAllProjects(config);

// Клонирование всех репозиториев
const results = await cloneAllRepositories(projects, config);

// Вывод отчёта
printSummary(results);
```

## Тестирование

```bash
npm test
```

Или из корня проекта:
```bash
make lib-test
```

Тесты расположены в `__tests__/` и используют Jest.

## Зависимости

- **zod** — валидация схем конфигурации
- **js-yaml** — парсинг YAML-файлов маппинга авторов
- **dotenv** — загрузка переменных окружения

## Лицензия

MIT
