# Актуализация документации, README, Makefile и CLAUDE.md

## Overview
Обновить документацию проекта с учетом текущего состояния, расширить примеры (средний
уровень: улучшить структуру, добавить новые разделы, расширить примеры). Это включает
синхронизацию README.MD (русский) и README.en.md (английский), документирование компонентов Electron/GUI,
расширение примеров, улучшение целей Makefile, создание README для Electron приложения и актуализацию
CLAUDE.md с информацией о проекте для агентов.

## Context
- Files involved: README.MD, README.en.md, Makefile, AGENTS.md, electron/README.md (новый), CLAUDE.md
- Related patterns: Русский primary, English secondary; async patterns; CLI + REST API + Electron GUI
- Dependencies: Недавние коммиты показывают добавление Electron frontend и PyInstaller bundling
- Project structure: CLI, REST API, и Electron GUI компоненты

## Development Approach
- Regular approach (modify files directly, no tests needed for documentation)
- Complete each task fully before moving to next
- Ensure consistency between Russian and English versions
- Follow existing documentation style and conventions

## Implementation Steps

### Task 1: Update README.MD (Russian) with Electron GUI section

**Files:**
- Modify: `README.MD`

- [x] Add new "Графический интерфейс (GUI)" section after "Использование" describing Electron GUI capabilities
- [x] Include instructions for running the GUI application
- [x] Add information about GUI bundling with electron-builder
- [x] Update "Требования" section to note Electron runtime requirements if needed
- [x] Review for logical flow and alignment with recent features

### Task 2: Update README.en.md (English) with Electron GUI section

**Files:**
- Modify: `README.en.md`

- [ ] Mirror changes from Task 1 in English
- [ ] Add "Graphical User Interface (GUI)" section with Electron description
- [ ] Include GUI bundling instructions paralleling Russian version
- [ ] Ensure consistency with Russian version structure and completeness

### Task 3: Create electron/README.md for Electron application

**Files:**
- Create: `electron/README.md`

- [ ] Add comprehensive guide for Electron application structure and setup
- [ ] Document how to run Electron app in development mode
- [ ] Include build instructions for creating distributable binaries
- [ ] Document available UI components and their purpose
- [ ] Add architecture overview (communication with Python backend via REST API)
- [ ] Include development requirements (Node.js version, npm packages)
- [ ] Add troubleshooting section for common Electron setup issues
- [ ] Include configuration options for electron-builder

### Task 4: Expand examples section in both READMEs

**Files:**
- Modify: `README.MD`, `README.en.md`

- [ ] Add "Примеры использования" (Examples) section in Russian README
- [ ] Include: OAuth with credential helper, dry-run mode, update mode examples
- [ ] Add real-world usage scenarios (syncing from private GitLab instance, specific project export)
- [ ] Mirror examples section in English README with parallel structure
- [ ] Include .env configuration examples

### Task 5: Enhance Makefile with new targets

**Files:**
- Modify: `Makefile`

- [ ] Add `make help` target displaying all available targets with descriptions
- [ ] Add `make clean` target to remove venv and build artifacts
- [ ] Add `make electron-build` target for building GUI binary
- [ ] Add `make coverage` target for running tests with coverage report
- [ ] Verify all existing targets still work correctly

### Task 6: Update AGENTS.md with Electron information

**Files:**
- Modify: `AGENTS.md`

- [ ] Add section describing Electron frontend structure and location
- [ ] Document REST API endpoints available to frontend
- [ ] Add GUI entry point information (`gitlab_downloader.gui.main`)
- [ ] Update project structure section to include `gitlab_downloader/gui/` directory
- [ ] Reference electron-builder configuration

### Task 7: Add Local Development section to README

**Files:**
- Modify: `README.MD`, `README.en.md`

- [ ] Add "Локальная разработка" (Local Development) section in Russian README
- [ ] Include guide for running CLI, GUI, and API together during development
- [ ] Add instructions for running tests and code quality checks
- [ ] Mirror section in English README with "Local Development" title
- [ ] Include typical developer workflow steps

### Task 8: Create or update CLAUDE.md with project information

**Files:**
- Create/Modify: `CLAUDE.md`

- [ ] Add project overview and purpose
- [ ] Document project structure and key directories
- [ ] Add information about CLI, REST API, and Electron GUI components
- [ ] Include key technologies and frameworks used
- [ ] Document configuration files and their purpose
- [ ] Add guidelines for code style and conventions
- [ ] Include information about running tests and building binaries
- [ ] Document the REST API endpoints for agent interaction
- [ ] Add important patterns and architectural decisions
- [ ] Include troubleshooting section for common development issues

### Task 9: Verify all documentation updates

- [ ] Check markdown syntax validity (no broken links, proper formatting)
- [ ] Verify Russian and English versions are synchronized in structure
- [ ] Test conceptual validity of code examples
- [ ] Confirm Makefile targets work: `make help`, `make install`, `make test`
- [ ] Review for typos, clarity, and tone consistency
- [ ] Final review of all changes

### Task 10: Move plan to completed folder

- [ ] Move this plan to `docs/plans/completed/2026-02-21-documentation-update.md`
- [ ] Commit documentation updates
