.PHONY: install lint test coverage build pack audit ci cli docker-build docker-run clean help

IMAGE_NAME ?= gitlab-dump
CLONE_PATH ?= $(CURDIR)/repositories

install:
	npm ci

lint:
	npm run lint

test:
	npm test

coverage:
	npm run test:coverage

build:
	npm run build

pack:
	npm run pack

audit:
	npm run audit

ci:
	npm ci
	npm run lint
	npm run test:coverage
	npm run build
	npm run audit

cli:
	node cli/bin/gitlab-dump.js $(ARGS)

docker-build:
	docker build -t $(IMAGE_NAME) .

docker-run: docker-build
	docker run --rm \
		--env GITLAB_URL \
		--env GITLAB_TOKEN \
		--env GITLAB_GROUP \
		--volume $(CLONE_PATH):/app/repositories \
		$(IMAGE_NAME) clone --url "$${GITLAB_URL}" --group "$${GITLAB_GROUP}" --clone-path /app/repositories

clean:
	rm -rf coverage electron/coverage electron/dist electron/dist_electron

help:
	@echo "install lint test coverage build pack audit ci cli docker-build docker-run clean"
	@echo "Example: make cli ARGS='transfer plan --help'"
