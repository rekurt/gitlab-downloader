# Gitlab Downloader - Project Reference

This document serves as a comprehensive reference for developers and AI agents working with the Gitlab Downloader project.

## Project Overview

Gitlab Downloader is an asynchronous utility for downloading and cloning all repositories from a GitLab group and its subgroups while preserving the directory structure. The project includes three main components:

1. **CLI Application** - Command-line interface for batch repository operations
2. **REST API Server** - FastAPI-based server for programmatic access
3. **Electron GUI** - Desktop application for interactive repository management

## Project Structure

```
gitlab-downloader/
├── gitlab_downloader/          # Main Python package
│   ├── __init__.py
│   ├── __main__.py             # CLI entry point
│   ├── app.py                  # Main application logic
│   ├── api.py                  # FastAPI application setup
│   ├── api_routes.py           # API endpoint definitions
│   ├── api_schemas.py          # Pydantic models for API
│   ├── auth.py                 # Authentication (OAuth, token-based)
│   ├── client.py               # GitLab API client
│   ├── cloner.py               # Git clone/pull logic
│   ├── config.py               # Configuration management
│   ├── models.py               # Data models
│   ├── migration.py            # Repository migration logic
│   ├── author_mapper.py        # Git author mapping
│   ├── constants.py            # Project constants
│   ├── utils.py                # Utility functions
│   ├── cli_ui.py               # CLI UI components
│   ├── logging_config.py       # Logging configuration
│   └── reporting.py            # Report generation
├── electron/                   # Electron GUI application
│   ├── main.js                 # Electron main process
│   ├── preload.js              # Electron preload script
│   ├── src/                    # React frontend
│   │   ├── App.js              # Main React component
│   │   ├── App.css             # App styling
│   │   ├── components/         # React components
│   │   ├── services/           # API client services
│   │   └── styles/             # CSS modules
│   ├── package.json            # Node dependencies
│   ├── webpack.config.js       # Webpack configuration
│   ├── electron-builder.yml    # Electron build config
│   └── README.md               # Electron-specific documentation
├── build/                      # Build scripts
├── docs/                       # Documentation
├── tests/                      # Test suite
├── Makefile                    # Development commands
├── pyproject.toml              # Python project configuration
├── .env.example                # Environment template
├── .gitignore                  # Git ignore rules
├── Dockerfile                  # Docker configuration
├── README.MD                   # Russian documentation (primary)
├── README.en.md                # English documentation (secondary)
├── AGENTS.md                   # Agent-specific documentation
└── CLAUDE.md                   # This file
```

## Key Technologies

- **Python**: 3.10+ (async-first design)
- **FastAPI**: Web framework for REST API
- **aiohttp**: Async HTTP client for GitLab API
- **GitLab API**: REST API v4 for repository management
- **Electron**: Cross-platform desktop GUI framework
- **React**: Frontend UI library for Electron app
- **Node.js**: JavaScript runtime for Electron and build tools
- **PyInstaller**: Python binary packaging
- **electron-builder**: Electron application packaging
- **pytest**: Testing framework
- **mypy**: Static type checking
- **ruff**: Code linting and formatting

## Configuration Files

### pyproject.toml
Main Python project configuration:
- Package metadata and dependencies
- Entry point: `gitlab-dump = "gitlab_downloader.app:run"`
- Optional dev dependencies: pytest, ruff, mypy
- Requires Python >= 3.10

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
- `make install` - Create venv and install dependencies
- `make run` - Run CLI application
- `make dry_run` - Run with --dry-run flag
- `make test` - Run test suite
- `make lint` - Check code with ruff
- `make format` - Format code with ruff
- `make typecheck` - Run mypy type checking
- `make ci` - Run linting, typecheck, and tests
- `make binary` - Build standalone binary (onedir)
- `make binary_onefile` - Build single-file binary
- `make clean` - Remove venv and build artifacts
- `make help` - Show all available targets
- `make electron-build` - Build Electron GUI application
- `make coverage` - Run tests with coverage report

### electron-builder.yml
Electron packaging configuration:
- Application metadata and icons
- Platform-specific build options (Windows, macOS, Linux)
- Auto-update configuration
- File inclusion/exclusion rules

### Dockerfile
Container configuration for running the application in Docker.

## Code Conventions and Style

### Python Code Style
- Use type hints throughout (mypy strict mode)
- Follow PEP 8 conventions
- Use async/await for I/O operations
- Document public functions and classes with docstrings
- Use f-strings for string formatting
- Maximum line length: 100 characters (Ruff default)

### Error Handling
- Use specific exception types (avoid bare except)
- Log errors with appropriate levels (WARNING, ERROR, CRITICAL)
- Provide context in exception messages for debugging
- Clean up resources in finally blocks or use context managers

### Naming Conventions
- Classes: PascalCase (e.g., `MigrationExecutor`)
- Functions/methods: snake_case (e.g., `fetch_group_metadata`)
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`)
- Private attributes: prefix with underscore (e.g., `_internal_state`)

### Async Patterns
- Use asyncio for concurrent operations
- Use `asyncio.gather()` for parallel tasks
- Use locks (`asyncio.Lock`) for shared state access
- Always await async functions; don't fire-and-forget
- Document async functions in docstrings

### Frontend (Electron/React)
- Functional components with hooks
- Use axios for API calls
- CSS modules for styling
- Service classes for API communication (see `src/services/`)

## REST API Endpoints

The API server runs on the configured host/port (default: localhost:8080) and provides the following endpoints:

### Status and Configuration
- `GET /api/status` - Get application status and version
- `GET /api/config` - Get current configuration
- `POST /api/config` - Update configuration

### Repository Operations
- `GET /api/repos` - List available repositories
  Response: `RepositoriesListResponse` with repository list and metadata

### Author and Committer Mapping
- `GET /api/author-mappings` - Get author mapping rules
- `POST /api/author-mappings` - Add/update author mapping rule
  Request: `AuthorMappingRequest` (original_name, original_email, new_name, new_email)

### Migration Operations
- `POST /api/migrate` - Start a migration task
  Request: `MigrationStartRequest` with configuration
  Returns: Migration task ID
- `GET /api/migration-progress/{migration_id}` - Get migration progress
  Response: `MigrationProgressResponse` with status and statistics

All API responses follow the Pydantic model schema definitions in `api_schemas.py`.

## Running the Application

### CLI Mode
```bash
gitlab-dump --help                           # Show help
gitlab-dump --version                        # Show version
gitlab-dump --url <url> --token <token> --group <group>  # Clone repositories
gitlab-dump --dry-run --url <url> --token <token>        # Preview without cloning
gitlab-dump --update --url <url> --token <token>         # Update existing repos
```

### API Server Mode
```bash
gitlab-dump --api-server --api-host 0.0.0.0 --api-port 8080
```

### Electron GUI
```bash
cd electron
npm install                    # Install dependencies
npm run dev                    # Run in development mode
npm run dist                   # Build for distribution
```

### Docker
```bash
make build                     # Build Docker image
make docker_run               # Run in Docker container
```

## Testing

Run tests with pytest:
```bash
make test                      # Run all tests
make coverage                  # Run with coverage report
```

Test suite includes:
- Unit tests for core modules
- Async operation tests
- API endpoint tests
- Mock responses for external services

Test files are located in the `tests/` directory matching package structure.

## Building Binaries

### Python Binary (PyInstaller)
```bash
make binary                    # Build standalone onedir binary
make binary_onefile           # Build single-file executable
make binary_clean             # Remove binary artifacts
```

### Electron Binary
```bash
make electron-build           # Build platform-appropriate binary
```

Outputs:
- Python: `dist/gitlab-dump/` or `dist/gitlab-dump.exe`
- Electron: `electron/dist/` with platform-specific installers

## Important Architectural Patterns

### Asynchronous Design
The Python application uses asyncio throughout for:
- Concurrent repository operations
- Non-blocking I/O for API calls and git operations
- Graceful shutdown with signal handlers
- Task progress tracking

### Client Architecture
- `client.py` handles GitLab API communication
- `auth.py` manages authentication (OAuth Device Flow or token-based)
- `cloner.py` orchestrates git clone/pull operations
- Configurable concurrency limits to prevent overwhelming servers

### Configuration Management
- Centralized `config.py` with `Config` dataclass
- Environment variable support via `.env`
- CLI argument overrides environment variables
- Validation at startup

### API Design
- Pydantic models for request/response validation
- Structured schemas in `api_schemas.py`
- Error responses with HTTP status codes
- OpenAPI/Swagger documentation available at `/docs`

### Frontend-Backend Communication
- Electron GUI communicates with API via REST endpoints
- Axios client with base URL configuration
- Service classes encapsulate API logic
- Proper error handling and user feedback

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

### API Server Issues
- Check port is not already in use
- Verify firewall allows access to configured port
- Check logs for detailed error messages
- Ensure backend API is running before Electron GUI connects

### Electron/GUI Problems
- Ensure Node.js and npm are installed
- Check Node version compatibility (14+)
- Verify API server is running on expected host/port
- Check browser console for React errors (F12 in dev mode)
- Review main.js for Electron configuration issues

### Type Checking Failures
- Run `make typecheck` to identify issues
- Add type hints for function parameters and returns
- Use Optional[Type] for nullable values
- Check mypy configuration in pyproject.toml

### Performance Issues
- Reduce `MAX_CONCURRENT_CLONES` in config
- Check system resource usage (CPU, memory, disk I/O)
- Enable logging to identify bottlenecks
- Consider pagination for large group operations

## Code Quality Standards

### Before Committing
1. Run `make format` to auto-format code
2. Run `make lint` to check for style issues
3. Run `make typecheck` for type errors
4. Run `make test` to ensure tests pass
5. Update documentation if APIs change

### CI Pipeline
The `make ci` target runs:
1. Ruff linter
2. mypy type checker
3. pytest test suite

All checks must pass before merging to main branch.

## Common Development Tasks

### Adding a New API Endpoint
1. Define request/response models in `api_schemas.py`
2. Add route handler in `api_routes.py`
3. Include proper error handling and validation
4. Add tests in `tests/test_api.py`
5. Document in this file's REST API section

### Adding CLI Arguments
1. Add argument definition in `config.py` parse_args()
2. Add field to `Config` dataclass
3. Update `.env.example` if environment variable supported
4. Add help text for --help output

### Modifying Authentication
1. Update logic in `auth.py`
2. Update config handling in `config.py`
3. Test with both OAuth and token methods
4. Update documentation in README files

### Frontend Changes (Electron)
1. Modify React components in `electron/src/components/`
2. Update styles in `electron/src/styles/`
3. Test in development mode: `npm run dev`
4. Build and test final package: `npm run dist`

## Language and Documentation

The project maintains dual-language documentation:
- **Russian (primary)**: README.MD, AGENTS.md comments, commit messages
- **English (secondary)**: README.en.md, code comments, docstrings

Keep both versions in sync for consistency.

## References

- GitLab API Documentation: https://docs.gitlab.com/ee/api/
- FastAPI Documentation: https://fastapi.tiangolo.com/
- Electron Documentation: https://www.electronjs.org/docs
- React Documentation: https://react.dev/
- Python asyncio: https://docs.python.org/3/library/asyncio.html
