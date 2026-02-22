.PHONY: run dry_run install build docker_run venv lint format test typecheck ci binary binary_onefile binary_clean help clean electron-build coverage

IMAGE_NAME=fetch-repositories
CLONE_PATH?=$(shell pwd)/repositories
VENV_PATH=venv

ifneq (,$(wildcard .env))
    include .env
    export $(shell sed 's/=.*//' .env)
endif

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

help:
	@echo "Available targets:"
	@echo "  make install           - Create virtual environment and install dependencies"
	@echo "  make run               - Run the CLI application"
	@echo "  make dry_run           - Run CLI with --dry-run flag"
	@echo "  make interactive       - Run CLI in interactive mode"
	@echo "  make test              - Run test suite with pytest"
	@echo "  make coverage          - Run tests with coverage report"
	@echo "  make lint              - Check code style with ruff"
	@echo "  make format            - Format code with ruff"
	@echo "  make typecheck         - Run type checking with mypy"
	@echo "  make ci                - Run linting, type checking, and tests (CI pipeline)"
	@echo "  make binary            - Build standalone binary with PyInstaller (onedir)"
	@echo "  make binary_onefile    - Build single-file binary with PyInstaller"
	@echo "  make binary_clean      - Remove binary build artifacts"
	@echo "  make clean             - Remove venv and build artifacts"
	@echo "  make electron-build    - Build Electron GUI application binary"
	@echo "  make build             - Build Docker image"
	@echo "  make docker_run        - Run application in Docker container"
	@echo "  make help              - Show this help message"

clean:
	@rm -rf $(VENV_PATH)
	@rm -rf build dist *.spec
	@rm -rf node_modules
	@find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete
	@echo "Cleaned: venv, build artifacts, and cache files"

electron-build:
	@cd electron && npm run dist
	@echo "Electron binary built successfully in electron/dist"

coverage:
	@$(VENV_PATH)/bin/pip install --no-cache-dir pytest-cov
	@$(VENV_PATH)/bin/pytest --cov=gitlab_downloader --cov-report=html --cov-report=term
	@echo "Coverage report generated in htmlcov/index.html"
