# Ревизия проекта gitlab-dump: выявленные проблемы и план исправлений

## Overview

Полная ревизия проекта gitlab-dump (асинхронная утилита для клонирования GitLab-репозиториев).
Выявление проблем, несоответствий, потенциальных багов и технического долга с последующим
планом исправлений.

## Context

- Files involved: все файлы пакета gitlab_downloader/, fetch_repositories.py, Dockerfile, Makefile, pyproject.toml, requirements.txt, AGENTS.md, README.MD, README.en.md, .env.example, tests/test_cloner_and_cli.py, .github/workflows/ci.yml
- Текущее состояние: тесты проходят (36), ruff и mypy чистые
- Ветка master на 8 коммитов впереди main; есть незакоммиченные изменения (staged + unstaged)

## Выявленные проблемы

### Критические

1. **Незакоммиченные staged-изменения на master**: файлы .env.example, README.MD, README.en.md, config.py, tests/test_cloner_and_cli.py имеют staged и unstaged изменения. Часть работы может быть потеряна.

2. **main ветка пустая (только Initial commit)**: вся работа на master, main не обновлен. PR workflow не работает в текущем виде.

3. **AGENTS.md устарел и не соответствует проекту**:
   - Упоминает "No automated test suite yet" -- на самом деле 36 тестов
   - Упоминает requirements.txt как основной способ установки, не упоминает pyproject.toml
   - Описывает fetch_repositories.py как "main entry; pulls GitLab groups/subgroups via REST and clones" -- на самом деле это просто обертка
   - Не описывает модульную архитектуру (auth, client, cloner, config, models, utils, reporting, logging_config)
   - Не упоминает OAuth, credential helper, interactive mode

### Существенные

4. **Dockerfile устарел**: копирует `fetch_repositories.py` и `gitlab_downloader/`, но `ENTRYPOINT` указывает на `python3 fetch_repositories.py`. Не устанавливает зависимости через pyproject.toml (используется requirements.txt). Нет поддержки pip install для entry point `gitlab-dump`.

5. **Дублирование зависимостей**: requirements.txt и pyproject.toml содержат одни и те же зависимости. requirements.txt может рассинхронизироваться с pyproject.toml.

6. **fetch_repositories.py содержит избыточные re-exports**: файл импортирует и экспортирует символы из всего пакета (GitlabConfig, CloneResult, fetch_json, fetch_paginated, etc.) через `__all__`. Это создает ложное впечатление публичного API, хотя файл используется только как entry point.

7. **`_CREDENTIAL_READY_HOSTS` в cloner.py -- глобальное мутабельное состояние**: это set на уровне модуля, который не сбрасывается между вызовами. При повторных запусках в одном процессе (тестирование) может скрывать ошибки.

8. **Нет теста для auth.py**: OAuth device flow, token refresh, cache read/write -- ни один из этих путей не покрыт тестами. Это самый сложный модуль с сетевыми вызовами.

9. **Нет тестов для client.py**: fetch_json, fetch_paginated, rate limiting, retry logic -- не покрыты.

10. **Нет тестов для reporting.py**: write_json_report, print_summary, print_dry_run -- не покрыты.

### Незначительные

11. **`asyncio_sleep` обертка в auth.py (строка 145-148)**: отдельная функция-обертка над `asyncio.sleep` только для тестируемости. При этом в cloner.py используется `asyncio.sleep` напрямую. Непоследовательный подход.

12. **`pyproject.toml` содержит `py-modules = ["fetch_repositories"]`** в секции `[tool.setuptools]`. Это legacy от старой структуры, когда проект был одним файлом.

13. **`_prompt_text` для secret не скрывает ввод** (config.py:150-151): параметр `secret=True` передается, но ввод идет через обычный `input()`, а не через `getpass.getpass()`. Токен виден на экране.

14. **`print_dry_run` использует фиксированные ширины колонок** (reporting.py:38-49): при длинных именах репозиториев или путей вывод будет сломан. Нет адаптации к терминалу.

15. **Нет `--version` флага**: пользователь не может узнать версию установленного инструмента.

16. **`CloneResult.status` -- строковый литерал без валидации**: используются строки "success", "updated", "skipped", "failed" без Literal типа или enum. Опечатка не будет поймана.

## Development Approach

- **Testing approach**: Regular (code first, then tests)
- Приоритет: сначала критические проблемы, затем существенные, затем мелкие
- Каждая задача содержит тесты где применимо
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Зафиксировать и упорядочить незакоммиченные изменения

**Files:**
- Modify: все staged/unstaged файлы

- [ ] Проанализировать текущие staged/unstaged изменения
- [ ] Создать коммит с осмысленным сообщением для текущих изменений
- [ ] Убедиться что рабочая директория чистая

### Task 2: Исправить секретный ввод токена в interactive mode

**Files:**
- Modify: `gitlab_downloader/config.py`

- [ ] Заменить `input()` на `getpass.getpass()` когда `secret=True` в `_prompt_text`
- [ ] Обновить тест `test_parse_args_interactive` для mock getpass
- [ ] Запустить тесты

### Task 3: Устранить дублирование зависимостей

**Files:**
- Modify: `Dockerfile`
- Modify: `Makefile`
- Remove: `requirements.txt` (опционально, или оставить как `pip install -e .` wrapper)

- [ ] Обновить Dockerfile для использования `pip install .` вместо `requirements.txt`
- [ ] Убрать `py-modules = ["fetch_repositories"]` из pyproject.toml
- [ ] Обновить Makefile если нужно
- [ ] Проверить что Docker build работает (dry-run Dockerfile review)
- [ ] Запустить тесты

### Task 4: Добавить тесты для client.py

**Files:**
- Create: `tests/test_client.py`

- [ ] Написать тесты для `fetch_json` (success, retry on 429/500, failure on 4xx)
- [ ] Написать тесты для `fetch_paginated` (multi-page, empty result)
- [ ] Написать тесты для `maybe_rate_limit_delay`
- [ ] Написать тесты для `get_all_projects` и `get_user_projects`
- [ ] Запустить тесты

### Task 5: Добавить тесты для auth.py

**Files:**
- Create: `tests/test_auth.py`

- [ ] Написать тесты для `resolve_access_token` (token mode)
- [ ] Написать тесты для OAuth cache read/write/validation
- [ ] Написать тесты для token refresh flow (mock aiohttp)
- [ ] Написать тесты для device flow polling (mock)
- [ ] Запустить тесты

### Task 6: Добавить тесты для reporting.py

**Files:**
- Create: `tests/test_reporting.py`

- [ ] Написать тесты для `print_summary` (с failed, без failed)
- [ ] Написать тесты для `write_json_report` (проверить JSON структуру)
- [ ] Написать тесты для `print_dry_run`
- [ ] Запустить тесты

### Task 7: Типизировать CloneResult.status через Literal

**Files:**
- Modify: `gitlab_downloader/models.py`
- Modify: `gitlab_downloader/cloner.py` (если нужно)
- Modify: `gitlab_downloader/reporting.py` (если нужно)

- [ ] Добавить `Literal["success", "updated", "skipped", "failed"]` для status в CloneResult
- [ ] Убедиться что mypy проходит
- [ ] Запустить тесты

### Task 8: Обновить AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] Описать текущую модульную архитектуру
- [ ] Обновить секцию Testing Guidelines (pytest, make test, CI)
- [ ] Упомянуть OAuth и credential helper
- [ ] Убрать устаревшую информацию

### Task 9: Добавить --version флаг

**Files:**
- Modify: `gitlab_downloader/config.py`
- Modify: `pyproject.toml` (если нужно для dynamic version)

- [ ] Добавить `--version` аргумент в parse_args
- [ ] Написать тест для `--version`
- [ ] Запустить тесты

### Task 10: Verify acceptance criteria

- [ ] Запустить полный test suite (`make test`)
- [ ] Запустить linter (`make lint`)
- [ ] Запустить type checker (`make typecheck`)
- [ ] Проверить покрытие тестами основных модулей (auth, client, reporting теперь покрыты)

### Task 11: Update documentation

- [ ] Обновить README.md если были user-facing изменения
- [ ] Обновить AGENTS.md (уже сделано в Task 8)
- [ ] Переместить план в `docs/plans/completed/`
