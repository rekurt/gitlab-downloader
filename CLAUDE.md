# Gitlab Downloader - Project Reference

This document serves as a comprehensive reference for developers and AI agents working with the Gitlab Downloader project.

## Project Overview

Gitlab Downloader is a utility for downloading and cloning all repositories from a GitLab group and its subgroups while preserving the directory structure. The project is built entirely in Node.js and includes three main components:

1. **Core Library** (`lib/`) - Shared Node.js modules for GitLab API, cloning, migration, and auth
2. **CLI Application** (`cli/`) - Standalone command-line interface using the core library
3. **Electron GUI** (`electron/`) - Desktop application using the core library via IPC

## Project Structure

```
gitlab-dump/
├── lib/                           # Shared Node.js core library (no Electron deps)
│   ├── package.json               # @gitlab-dump/core package
│   ├── index.js                   # Re-exports all modules
│   ├── client.js                  # GitLab API client (pagination, retry, rate limit)
│   ├── cloner.js                  # Git clone/pull with concurrency control
│   ├── auth.js                    # OAuth device flow + token auth
│   ├── migration.js               # Git author/committer rewriting (filter-branch)
│   ├── author-mapper.js           # Author mapping load/save (JSON/YAML)
│   ├── config.js                  # Configuration model + validation (Zod)
│   ├── constants.js               # Default values and limits
│   ├── utils.js                   # Path sanitization, URL building, credential stripping
│   ├── reporting.js               # Summary/dry-run/JSON report generation
│   └── __tests__/                 # Jest tests for all modules
├── cli/                           # Standalone CLI (no Electron dependency)
│   ├── package.json               # gitlab-dump-cli package
│   ├── bin/
│   │   └── gitlab-dump.js         # CLI entry point
│   ├── index.js                   # CLI logic (arg parsing, interactive mode)
│   ├── ui.js                      # Terminal UI (prompts, tables, colored output)
│   └── __tests__/                 # Jest tests
├── electron/                      # Electron GUI (uses lib/ directly via IPC)
│   ├── main.js                    # Main process (IPC handlers calling lib/)
│   ├── preload.js                 # IPC bridge (secure channel whitelist)
│   ├── env.js                     # Environment configuration
│   ├── src/
│   │   ├── App.js                 # Main React component (view switching)
│   │   ├── components/            # React components (Ant Design + Tailwind CSS)
│   │   │   ├── AppLayout.js       # Layout with sidebar navigation
│   │   │   ├── SettingsPage.js    # Settings form with persistent storage
│   │   │   ├── OAuthDeviceFlow.js # OAuth Device Flow authorization
│   │   │   ├── ProjectsPage.js    # GitLab projects browser
│   │   │   ├── ClonePage.js       # Clone/update operations with progress
│   │   │   ├── RepoList.js        # Local repositories list
│   │   │   ├── MigrationWizard.js # Step-by-step migration wizard
│   │   │   ├── AuthorMapper.js    # Author/committer mapping editor
│   │   │   └── ProgressIndicator.js # Migration progress indicator
│   │   └── styles/
│   │       └── globals.css        # Tailwind directives + Ant Design reset
│   ├── tailwind.config.js         # Tailwind CSS configuration
│   ├── postcss.config.js          # PostCSS configuration
│   ├── package.json               # Node dependencies
│   ├── webpack.config.js          # Webpack configuration (+ postcss-loader)
│   ├── electron-builder.config.js # Electron build config
│   ├── __tests__/                 # Jest tests
│   └── README.md                  # Electron-specific documentation
├── gitlab_downloader/             # Legacy Python package (preserved for reference)
├── tests/                         # Legacy Python test suite
├── docs/                          # Documentation and plans
├── package.json                   # Root workspace package
├── Makefile                       # Development commands
├── pyproject.toml                 # Legacy Python project configuration
├── .env.example                   # Environment template
├── .gitignore                     # Git ignore rules
├── Dockerfile                     # Docker configuration
├── README.MD                      # Russian documentation (primary)
├── README.en.md                   # English documentation (secondary)
├── AGENTS.md                      # Agent-specific documentation
└── CLAUDE.md                      # This file
```

## Key Technologies

- **Node.js**: JavaScript runtime (ES modules)
- **Zod**: Schema validation for configuration
- **js-yaml**: YAML parsing for author mappings
- **commander**: CLI argument parsing
- **inquirer**: Interactive terminal prompts
- **chalk**: Terminal colored output
- **dotenv**: Environment variable loading
- **Electron**: Cross-platform desktop GUI framework
- **React**: Frontend UI library for Electron app
- **Ant Design (antd)**: UI component library for Electron app
- **Tailwind CSS**: Utility-first CSS framework for Electron app
- **electron-store**: Persistent settings storage for Electron app
- **Webpack**: Module bundler for Electron renderer
- **electron-builder**: Electron application packaging
- **Jest**: Testing framework
- **ESLint**: Code linting

## Configuration Files

### package.json (root)
Root workspace package with scripts for running tests across all packages.

### lib/package.json
Core library: `@gitlab-dump/core`, type: module (ESM).

### cli/package.json
CLI application: `gitlab-dump-cli`, depends on `@gitlab-dump/core` via file reference.

### electron/package.json
Desktop application: `gitlab-dump-desktop`, depends on `@gitlab-dump/core` via file reference.

### .env and .env.example
Environment variables (required or optional):
- `GITLAB_URL`: GitLab instance URL (default: https://gitlab.com)
- `GITLAB_TOKEN`: Personal access token for authentication
- `AUTH_METHOD`: Authentication method (oauth, token)
- `GIT_AUTH_MODE`: Git credential handling (url, credential_helper)
- `GITLAB_OAUTH_CLIENT_ID`: OAuth client ID (if using OAuth)
- `CLONE_PATH`: Directory for cloned repositories (default: ./repositories)
- `GITLAB_GROUP`: Group ID/path (optional; uses user membership if omitted)

### Makefile
Development commands:

Node.js targets:
- `make node-install` - Install dependencies for lib, cli, and electron
- `make lib-test` - Run lib/ tests
- `make cli-test` - Run cli/ tests
- `make electron-test` - Run electron/ tests
- `make node-test` - Run all Node.js tests (lib + cli + electron)
- `make node-lint` - Run ESLint on Node.js source files
- `make node-ci` - Node.js CI pipeline (lint + tests)
- `make cli-run` - Run CLI application
- `make cli-dry-run` - Run CLI with --dry-run flag
- `make electron-build` - Build Electron GUI application binary

Legacy Python targets (still available):
- `make install` - Create venv and install Python dependencies
- `make run` - Run Python CLI application
- `make test` - Run Python test suite with pytest
- `make lint` - Check Python code with ruff
- `make format` - Format Python code with ruff
- `make typecheck` - Run mypy type checking
- `make ci` - Run Python linting, typecheck, and tests
- `make binary` - Build standalone Python binary (onedir)
- `make binary_onefile` - Build single-file Python binary

General:
- `make clean` - Remove venv, node_modules, and build artifacts
- `make help` - Show all available targets

### electron-builder.config.js
Electron packaging configuration:
- Application metadata and icons
- Platform-specific build options (Windows, macOS, Linux)
- Auto-update configuration
- File inclusion/exclusion rules

### Dockerfile
Container configuration for running the application in Docker.

## Code Conventions and Style

### JavaScript Code Style
- ES modules (import/export) throughout
- Use JSDoc for function documentation
- camelCase for functions and variables
- PascalCase for classes
- UPPER_SNAKE_CASE for constants
- Maximum line length: 100 characters

### Error Handling
- Use specific exception types (avoid bare catch)
- Provide context in error messages for debugging
- Clean up resources in finally blocks
- Use AbortController for cancellable operations

### Naming Conventions
- Classes: PascalCase (e.g., `AuthorMapper`)
- Functions/methods: camelCase (e.g., `fetchGroupMetadata`)
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`)
- Private attributes: prefix with underscore (e.g., `_internalState`)

### Frontend (Electron/React)
- Functional components with hooks
- IPC communication via `window.electronAPI` (preload bridge)
- Ant Design components for UI elements (Table, Form, Steps, Progress, etc.)
- Tailwind CSS utility classes for layout and spacing
- No CSS modules — use `globals.css` with Tailwind directives
- No HTTP calls — all data flows through IPC
- Settings persisted via `electron-store` (loaded on startup)

## Running the Application

### CLI Mode
```bash
node cli/bin/gitlab-dump.js --help
node cli/bin/gitlab-dump.js --version
node cli/bin/gitlab-dump.js --url <url> --token <token> --group <group>
node cli/bin/gitlab-dump.js --dry-run --url <url> --token <token>
node cli/bin/gitlab-dump.js --update --url <url> --token <token>
node cli/bin/gitlab-dump.js --interactive
node cli/bin/gitlab-dump.js --interactive-menu
```

Or via Makefile:
```bash
make cli-run
make cli-dry-run
```

### Electron GUI
```bash
cd electron
npm install
npm run dev       # Development mode with hot reload
npm run dist      # Build for distribution
```

### Docker
```bash
make build                     # Build Docker image
make docker_run               # Run in Docker container
```

## Testing

Run tests with Jest:
```bash
make node-test                 # Run all Node.js tests
make lib-test                  # Run lib/ tests only
make cli-test                  # Run cli/ tests only
make electron-test             # Run electron/ tests only
```

Test suite includes:
- Unit tests for all core library modules
- CLI argument parsing and workflow tests
- Electron IPC handler tests
- React component tests
- Mock responses for external services

Test files are located in `__tests__/` directories within each package.

## Building Binaries

### Electron Binary
```bash
make electron-build           # Build platform-appropriate binary
```

Output: `electron/dist_electron/` with platform-specific installers

## Important Architectural Patterns

### Communication Flow
- **CLI**: `cli/` imports and calls `lib/` modules directly
- **Electron**: Renderer → IPC (preload.js) → Main process → `lib/` modules

### Core Library (lib/)
- `client.js` handles GitLab API communication (pagination, retry, rate limits)
- `auth.js` manages authentication (OAuth Device Flow or token-based)
- `cloner.js` orchestrates git clone/pull operations with concurrency control
- `migration.js` handles git author/committer rewriting via filter-branch
- `author-mapper.js` loads/saves author mapping configuration (JSON/YAML)
- `config.js` provides Zod-based configuration validation
- `reporting.js` generates summary, dry-run, and JSON reports

### Configuration Management
- Centralized `config.js` with Zod schema validation
- Environment variable support via dotenv
- CLI argument overrides environment variables
- Validation at startup

### Electron IPC Design
- Preload script exposes whitelisted IPC channels via `contextBridge`
- Main process registers `ipcMain.handle()` for each channel
- Progress events delivered via `webContents.send()`: `migration-progress`, `oauth-progress`, `clone-progress`
- Active operations (migrations, fetches, clones) tracked with AbortControllers for cancellation
- `electron-store` used for persistent settings (lazy ESM import via `getStore()`)
- Core library (`@gitlab-dump/core`) loaded via lazy ESM import (`getCoreLib()`)

## Troubleshooting

### GitLab API Connection Issues
- Verify `GITLAB_URL` is correct (http/https protocol)
- Check token validity and expiration
- Ensure OAuth app is registered if using OAuth auth
- Check network connectivity and firewall rules

### Git Clone/Pull Failures
- Verify SSH keys are configured if using SSH URLs
- Check git credential helper configuration
- Ensure sufficient disk space for cloning
- Verify Unix file permissions for clone path

### Electron/GUI Problems
- Ensure Node.js and npm are installed
- Check Node version compatibility (16+)
- Check browser console for React errors (F12 in dev mode)
- Review main.js console output for IPC handler errors

### Performance Issues
- Reduce concurrency limit in config
- Check system resource usage (CPU, memory, disk I/O)
- Enable logging to identify bottlenecks
- Consider pagination for large group operations

## Code Quality Standards

### Before Committing
1. Run `make node-lint` to check for style issues
2. Run `make node-test` to ensure tests pass
3. Update documentation if APIs change

### CI Pipeline
The `make node-ci` target runs:
1. ESLint linter
2. Jest test suite (lib + cli + electron)

All checks must pass before merging to main branch.

## Common Development Tasks

### Adding a New lib/ Module
1. Create the module file in `lib/`
2. Export it from `lib/index.js`
3. Add export path to `lib/package.json` exports map
4. Write tests in `lib/__tests__/`
5. Document in this file

### Adding CLI Arguments
1. Add option to commander in `cli/index.js`
2. Add corresponding config field in `lib/config.js` if needed
3. Update `.env.example` if environment variable supported
4. Add help text for --help output

### Adding IPC Channels (Electron)
1. Add handler in `electron/main.js` via `ipcMain.handle()`
2. Expose in `electron/preload.js` via `contextBridge`
3. Use in React components via `window.electronAPI`
4. Write tests in `electron/__tests__/`

### Frontend Changes (Electron)
1. Modify React components in `electron/src/components/`
2. Use Ant Design components for UI elements, Tailwind CSS for utilities
3. Test in development mode: `npm run dev`
4. Build and test final package: `npm run dist`

## Language and Documentation

The project maintains dual-language documentation:
- **Russian (primary)**: README.MD, AGENTS.md comments, commit messages
- **English (secondary)**: README.en.md, code comments, docstrings

Keep both versions in sync for consistency.

## References

- GitLab API Documentation: https://docs.gitlab.com/ee/api/
- Electron Documentation: https://www.electronjs.org/docs
- React Documentation: https://react.dev/
- Zod Documentation: https://zod.dev/
- Commander.js: https://github.com/tj/commander.js/
