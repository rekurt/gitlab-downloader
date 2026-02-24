.PHONY: run dry_run install build docker_run venv lint format test typecheck ci binary binary_onefile binary_clean help clean electron-build coverage node-install lib-test cli-test electron-test node-test node-ci cli-run cli-dry-run

IMAGE_NAME=fetch-repositories
CLONE_PATH?=$(shell pwd)/repositories
VENV_PATH=venv

ifneq (,$(wildcard .env))
    include .env
    export $(shell sed 's/=.*//' .env)
endif

# ─── Node.js targets ───

node-install:
	@npm install --prefix lib
	@npm install --prefix cli
	@npm install --prefix electron

lib-test:
	@node --experimental-vm-modules lib/node_modules/.bin/jest --config lib/jest.config.js

cli-test:
	@node --experimental-vm-modules cli/node_modules/.bin/jest --config cli/jest.config.js

electron-test:
	@node --experimental-vm-modules electron/node_modules/.bin/jest --config electron/jest.config.js

node-test: lib-test cli-test electron-test

node-ci: node-test

cli-run:
	@node cli/bin/gitlab-dump.js

cli-dry-run:
	@node cli/bin/gitlab-dump.js --dry-run

electron-build:
	@cd electron && npm run dist
	@echo "Electron binary built successfully in electron/dist_electron"

# ─── Python targets (legacy) ───

run:
	@$(VENV_PATH)/bin/gitlab-dump

dry_run:
	@$(VENV_PATH)/bin/gitlab-dump --dry-run

interactive:
	@$(VENV_PATH)/bin/gitlab-dump --interactive

venv:
	@[ -d $(VENV_PATH) ] || python3 -m venv $(VENV_PATH)
	@$(VENV_PATH)/bin/pip install --upgrade pip
	@$(VENV_PATH)/bin/pip install --no-cache-dir -e .[dev]

install: venv

lint:
	@$(VENV_PATH)/bin/ruff check .

format:
	@$(VENV_PATH)/bin/ruff format .

test:
	@$(VENV_PATH)/bin/pytest

typecheck:
	@$(VENV_PATH)/bin/mypy gitlab_downloader

ci: lint typecheck test

binary:
	@$(VENV_PATH)/bin/pip install --no-cache-dir pyinstaller
	@$(VENV_PATH)/bin/pyinstaller --onedir --name gitlab-dump --exclude-module multiprocessing gitlab_downloader/__main__.py

binary_onefile:
	@$(VENV_PATH)/bin/pip install --no-cache-dir pyinstaller
	@$(VENV_PATH)/bin/pyinstaller --onefile --name gitlab-dump --exclude-module multiprocessing gitlab_downloader/__main__.py

binary_clean:
	@rm -rf build dist *.spec

# ─── Docker ───

build:
	docker build -t $(IMAGE_NAME) .

docker_run: build
	docker run --rm \
		--env GITLAB_URL=$(GITLAB_URL) \
		--env GITLAB_TOKEN=$(GITLAB_TOKEN) \
		--env GITLAB_GROUP=$(GITLAB_GROUP) \
		--env CLONE_PATH=/app/repositories \
		-v $(CLONE_PATH):/app/repositories \
		$(IMAGE_NAME)

# ─── General ───

help:
	@echo "Available targets:"
	@echo ""
	@echo "  Node.js:"
	@echo "  make node-install      - Install dependencies for lib, cli, and electron"
	@echo "  make lib-test          - Run lib/ tests"
	@echo "  make cli-test          - Run cli/ tests"
	@echo "  make electron-test     - Run electron/ tests"
	@echo "  make node-test         - Run all Node.js tests (lib + cli + electron)"
	@echo "  make node-ci           - Run Node.js CI pipeline (tests)"
	@echo "  make cli-run           - Run CLI application"
	@echo "  make cli-dry-run       - Run CLI with --dry-run flag"
	@echo "  make electron-build    - Build Electron GUI application binary"
	@echo ""
	@echo "  Python (legacy):"
	@echo "  make install           - Create virtual environment and install dependencies"
	@echo "  make run               - Run the Python CLI application"
	@echo "  make dry_run           - Run Python CLI with --dry-run flag"
	@echo "  make interactive       - Run Python CLI in interactive mode"
	@echo "  make test              - Run Python test suite with pytest"
	@echo "  make coverage          - Run Python tests with coverage report"
	@echo "  make lint              - Check Python code style with ruff"
	@echo "  make format            - Format Python code with ruff"
	@echo "  make typecheck         - Run type checking with mypy"
	@echo "  make ci                - Run Python linting, type checking, and tests"
	@echo "  make binary            - Build standalone Python binary (onedir)"
	@echo "  make binary_onefile    - Build single-file Python binary"
	@echo "  make binary_clean      - Remove binary build artifacts"
	@echo ""
	@echo "  General:"
	@echo "  make clean             - Remove venv, node_modules, and build artifacts"
	@echo "  make build             - Build Docker image"
	@echo "  make docker_run        - Run application in Docker container"
	@echo "  make help              - Show this help message"

clean:
	@rm -rf $(VENV_PATH)
	@rm -rf build dist *.spec
	@rm -rf lib/node_modules cli/node_modules electron/node_modules
	@find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete
	@echo "Cleaned: venv, node_modules, build artifacts, and cache files"

coverage:
	@$(VENV_PATH)/bin/pip install --no-cache-dir pytest-cov
	@$(VENV_PATH)/bin/pytest --cov=gitlab_downloader --cov-report=html --cov-report=term
	@echo "Coverage report generated in htmlcov/index.html"
