.PHONY: help clean \
       node-install lib-test cli-test electron-test node-test node-lint node-ci \
       cli-run cli-dry-run electron-build \
       docker-build docker-run

# ─── Configuration ───

IMAGE_NAME  := fetch-repositories
CLONE_PATH  ?= $(shell pwd)/repositories
JEST        := node --experimental-vm-modules

ifneq (,$(wildcard .env))
    include .env
    export $(shell sed 's/=.*//' .env)
endif

# ─── Node.js: Setup ───

node-install:
	@npm install --prefix lib
	@npm install --prefix cli
	@npm install --prefix electron

# ─── Node.js: Testing ───

lib-test:
	@$(JEST) lib/node_modules/.bin/jest --config lib/jest.config.js

cli-test:
	@$(JEST) cli/node_modules/.bin/jest --config cli/jest.config.js

electron-test:
	@$(JEST) electron/node_modules/.bin/jest --config electron/jest.config.js

node-test: lib-test cli-test electron-test

# ─── Node.js: Linting ───

node-lint:
	@lib/node_modules/.bin/eslint --config lib/eslint.config.js \
		lib/*.js cli/index.js cli/ui.js cli/bin/gitlab-dump.js

# ─── Node.js: CI ───

node-ci: node-lint node-test

# ─── Node.js: Run ───

cli-run:
	@node cli/bin/gitlab-dump.js

cli-dry-run:
	@node cli/bin/gitlab-dump.js --dry-run

# ─── Electron ───

electron-build:
	@cd electron && npm run dist
	@echo "Electron binary built successfully in electron/dist_electron"

# ─── Docker ───

docker-build:
	docker build -t $(IMAGE_NAME) .

docker-run: docker-build
	docker run --rm \
		--env GITLAB_URL=$(GITLAB_URL) \
		--env GITLAB_TOKEN=$(GITLAB_TOKEN) \
		--env GITLAB_GROUP=$(GITLAB_GROUP) \
		--env CLONE_PATH=/app/repositories \
		-v $(CLONE_PATH):/app/repositories \
		$(IMAGE_NAME)

# ─── General ───

clean:
	@rm -rf lib/node_modules cli/node_modules electron/node_modules
	@rm -rf electron/dist_electron
	@echo "Cleaned: node_modules and build artifacts"

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  Setup:"
	@echo "    node-install       Install dependencies for lib, cli, and electron"
	@echo ""
	@echo "  Testing:"
	@echo "    lib-test           Run lib/ tests"
	@echo "    cli-test           Run cli/ tests"
	@echo "    electron-test      Run electron/ tests"
	@echo "    node-test          Run all tests (lib + cli + electron)"
	@echo ""
	@echo "  Quality:"
	@echo "    node-lint          Run ESLint on Node.js source files"
	@echo "    node-ci            CI pipeline (lint + tests)"
	@echo ""
	@echo "  Run:"
	@echo "    cli-run            Run CLI application"
	@echo "    cli-dry-run        Run CLI with --dry-run flag"
	@echo "    electron-build     Build Electron application binary"
	@echo ""
	@echo "  Docker:"
	@echo "    docker-build       Build Docker image"
	@echo "    docker-run         Run application in Docker container"
	@echo ""
	@echo "  General:"
	@echo "    clean              Remove node_modules and build artifacts"
	@echo "    help               Show this help message"
