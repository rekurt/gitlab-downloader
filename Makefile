.PHONY: run dry_run install build docker_run venv lint format test typecheck ci binary binary_onefile binary_clean

IMAGE_NAME=fetch-repositories
CLONE_PATH?=$(shell pwd)/repositories
VENV_PATH=venv

ifneq (,$(wildcard .env))
    include .env
    export $(shell sed 's/=.*//' .env)
endif

run:
	@$(VENV_PATH)/bin/python fetch_repositories.py

dry_run:
	@$(VENV_PATH)/bin/python fetch_repositories.py --dry-run

interactive:
	@$(VENV_PATH)/bin/python fetch_repositories.py --interactive

venv:
	@[ -d $(VENV_PATH) ] || python3 -m venv $(VENV_PATH)
	@$(VENV_PATH)/bin/pip install --upgrade pip
	@$(VENV_PATH)/bin/pip install --no-cache-dir -r requirements.txt
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
	@$(VENV_PATH)/bin/pyinstaller --onedir --name gitlab-dump --exclude-module multiprocessing fetch_repositories.py

binary_onefile:
	@$(VENV_PATH)/bin/pip install --no-cache-dir pyinstaller
	@$(VENV_PATH)/bin/pyinstaller --onefile --name gitlab-dump --exclude-module multiprocessing fetch_repositories.py

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
