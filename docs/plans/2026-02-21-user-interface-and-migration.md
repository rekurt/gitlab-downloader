# User Interface и Migration для gitlab-dump (Electron + CLI с однофайловой упаковкой)

## Overview
Добавление приложения на Electron для управления клонированием репозиториев с GitLab и миграцией их на другой гит хостинг. Реализация функции миграции с визардом для замены авторов коммитов и коммиттеров. Сохранение CLI интерфейса с интерактивным меню. Добавление процесса компиляции под все популярные платформы (Windows, macOS, Linux) с упаковкой результирующего приложения в один файл (standalone executable).

## Context
- Существующий проект: Python-приложение gitlab-dump для клонирования репозиториев
- Текущая архитектура: CLI-приложение через argparse в app.py
- Файлы: app.py, cloner.py, client.py, config.py, auth.py, models.py
- Требование: CLI с интерактивным меню + Electron desktop приложение
- Миграция: поддержка любых гит хостингов с API
- Замена данных: имя, email автора и коммиттера
- Хранение конфигурации: JSON/YAML файлы рядом с репозиториями
- Архитектура: Python backend с REST API + Electron frontend
- Кросс-платформность: сборка под Windows (exe), macOS (app), Linux (AppImage) с упаковкой в один файл
- Упаковка: использование PyInstaller для Python backend + electron-builder для Electron с встроенным бинарником

## Development Approach
- **Testing approach**: TDD (тесты сначала)
- Завершить каждую задачу полностью перед следующей
- Все тесты должны проходить перед началом следующей задачи
- Следовать существующим паттернам в проекте
- **CRITICAL: каждая задача ДОЛЖНА включать новые/обновлённые тесты**
- **CRITICAL: все тесты должны проходить перед началом следующей задачи**

## Implementation Steps

### Task 1: Create migration module with author mapping

**Files:**
- Create: `gitlab_downloader/migration.py`
- Create: `gitlab_downloader/author_mapper.py`
- Modify: `gitlab_downloader/models.py` (добавить MigrationConfig модель)

- [x] Define MigrationConfig dataclass with fields: source_repos_path, target_hosting_url, target_token, author_mappings, committer_mappings
- [x] Create AuthorMapper class to handle reading/writing JSON/YAML mappings to disk
- [x] Create MigrationExecutor class with methods for author/committer replacement in git history
- [x] Implement git filter-branch или git-rebase logic for author/committer replacement
- [x] write tests for migration module and author mapper
- [x] run project test suite - must pass before task 2

### Task 2: Build enhanced CLI with interactive menu using Rich

**Files:**
- Create: `gitlab_downloader/cli_ui.py` (Rich-based interactive menu)
- Modify: `gitlab_downloader/app.py` (integrate new CLI flow)
- Modify: `gitlab_downloader/config.py` (add migration options)

- [x] Create interactive menu with Rich (clone, migrate, view history)
- [x] Add migration flow: select repos, configure author mappings (interactive form), preview changes
- [x] Add ability to save/load migration configuration from JSON/YAML
- [x] Integrate with existing clone functionality
- [x] write tests for CLI UI interactions
- [x] run project test suite - must pass before task 3

### Task 3: Create Python REST API backend for Electron

**Files:**
- Create: `gitlab_downloader/api.py` (FastAPI application)
- Create: `gitlab_downloader/api_routes.py` (API endpoints)
- Create: `gitlab_downloader/api_schemas.py` (Pydantic models)
- Modify: `gitlab_downloader/app.py` (add API server launch option)

- [x] Set up FastAPI application with proper CORS settings for Electron
- [x] Create endpoints: GET /api/status, GET /api/repos (list cloned repos), POST /api/migrate (start migration)
- [x] Create endpoint for author mapping: GET /api/author-mappings, POST /api/author-mappings
- [x] Create endpoint for migration progress: GET /api/migration-progress/{repo_id}
- [x] Implement async handling for long-running migration tasks
- [x] Add proper error handling and logging
- [x] write tests for API routes and schemas
- [x] run project test suite - must pass before task 4

### Task 4: Create Electron application structure

**Files:**
- Create: `electron/` (new directory for Electron app)
- Create: `electron/package.json` (main and dev dependencies)
- Create: `electron/main.js` (Electron main process)
- Create: `electron/preload.js` (IPC bridge for security)
- Create: `electron/src/` (frontend source directory)

- [x] Initialize Electron project structure
- [x] Configure main.js to launch Python API backend on app start
- [x] Set up preload.js for safe IPC communication between Electron and Python
- [x] Configure webpack/vite for bundling frontend code
- [x] Set up environment configuration for dev/prod
- [x] write tests for Electron main process
- [x] run project test suite - must pass before task 5

### Task 5: Create Electron frontend components

**Files:**
- Create: `electron/src/components/RepoList.js` (React component)
- Create: `electron/src/components/MigrationWizard.js` (step-by-step UI)
- Create: `electron/src/components/AuthorMapper.js` (author mapping UI)
- Create: `electron/src/App.js` (main application)
- Create: `electron/src/index.html`
- Create: `electron/src/styles/` (CSS/styling)

- [x] Create component for displaying cloned repositories
- [x] Create migration wizard with step-by-step UI (select repos, map authors, confirm)
- [x] Create author mapper UI (interactive table/form for author replacements)
- [x] Create progress indicator for migration tasks
- [x] Create main application layout with navigation
- [x] Implement communication with Python backend via IPC
- [x] write tests for components
- [x] run project test suite - must pass before task 6

### Task 6: Integrate Python backend with Electron frontend

**Files:**
- Modify: `electron/main.js` (spawn Python API process)
- Modify: `gitlab_downloader/api.py` (add shutdown handling)
- Create: `electron/src/services/api.js` (Electron-side API client)

- [x] Implement process spawning of Python backend from Electron main
- [x] Set up IPC bridge for frontend-to-backend communication
- [x] Create API client service in Electron for calling Python endpoints
- [x] Handle backend process lifecycle (start, stop, error handling)
- [x] Configure proper logging and error reporting
- [x] write integration tests for backend-frontend communication
- [x] run project test suite - must pass before task 7

### Task 7: Add migration configuration file support

**Files:**
- Modify: `gitlab_downloader/migration.py`
- Modify: `gitlab_downloader/config.py`
- Modify: `electron/src/services/api.js`

- [x] Support loading migration config from JSON/YAML in clone directory
- [x] Implement schema validation for config files
- [x] Add Electron UI features to view/edit config files
- [x] Add ability to save config from UI back to disk
- [x] write tests for config file handling
- [x] run project test suite - must pass before task 8

### Task 8: Setup PyInstaller for Python backend bundling

**Files:**
- Create: `build/pyinstaller_spec.spec` (PyInstaller specification)
- Create: `build/create_python_binary.py` (Python binary builder script)
- Modify: `gitlab_downloader/app.py` (add api-server mode)

- [x] Configure PyInstaller to create standalone Python binary (api-server executable)
- [x] Include all dependencies and assets in the binary
- [x] Set up proper paths for config files within bundled app
- [x] Handle platform-specific configurations (Windows, macOS, Linux)
- [x] Create build script that generates platform-specific binaries
- [x] Test standalone binary on each platform (Windows exe, macOS app, Linux binary)
- [x] write tests for binary bundling verification
- [x] run project test suite - must pass before task 9

### Task 9: Setup electron-builder for single-file distribution

**Files:**
- Create: `electron-builder.config.js` (electron-builder configuration)
- Create: `build/embed_python_binary.js` (script to embed Python binary)
- Modify: `electron/main.js` (use bundled Python binary)
- Modify: `electron/package.json` (build scripts and dependencies)

- [x] Configure electron-builder for single-file output (portable exe, dmg, AppImage)
- [x] Set up logic to embed compiled Python binary into Electron bundle
- [x] Configure for Windows portable exe (single .exe file)
- [x] Configure for macOS app bundle (single .app file)
- [x] Configure for Linux AppImage (single .AppImage file)
- [x] Update main.js to extract and launch embedded Python binary on first run
- [x] Configure code signing for macOS (optional but recommended)
- [x] write tests for bundling verification
- [x] run project test suite - must pass before task 10

### Task 10: Verify acceptance criteria

- [ ] manual test: run CLI standalone
- [ ] manual test: launch single-file Electron app on Windows
- [ ] manual test: launch single-file Electron app on macOS
- [ ] manual test: launch single-file Electron app on Linux
- [ ] manual test: clone repos via app
- [ ] manual test: run migration wizard with author mapping
- [ ] manual test: verify author/committer changes in migrated repos
- [ ] manual test: verify config files save/load correctly
- [ ] manual test: app starts without external dependencies
- [ ] run full test suite (pytest for backend + frontend tests)
- [ ] run linter (if configured)
- [ ] verify all tests pass

### Task 11: Update documentation

- [ ] update README.md with CLI UI usage instructions
- [ ] update README.md with Electron app download and setup instructions
- [ ] add developer documentation for build process
- [ ] add instructions for building single-file distributions
- [ ] add troubleshooting guide for cross-platform issues
- [ ] update CLAUDE.md if internal patterns changed
- [ ] move this plan to docs/plans/completed/
