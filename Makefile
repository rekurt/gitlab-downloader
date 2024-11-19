.PHONY: run install check_env build docker_run venv

# Имя образа
IMAGE_NAME=fetch-repositories

# Абсолютный путь для клонирования репозиториев
CLONE_PATH=$(shell pwd)/repositories

# Путь к виртуальному окружению
VENV_PATH=venv

# Загрузка переменных из .env файла
ifneq (,$(wildcard .env))
    include .env
    export $(shell sed 's/=.*//' .env)
endif

# Команда для запуска скрипта локально
run: check_env
	@echo "Запуск скрипта с переменными окружения..."
	@$(VENV_PATH)/bin/python fetch_repositories.py

# Создание и установка виртуального окружения
venv:
	@echo "Создание виртуального окружения..."
	python3 -m venv $(VENV_PATH)
	@echo "Установка зависимостей в виртуальное окружение..."
	$(VENV_PATH)/bin/pip install --no-cache-dir -r requirements.txt

# Установка зависимостей в виртуальное окружение
install: venv
	@echo "Зависимости успешно установлены."

# Проверка переменных окружения
check_env:
	@if [ -z "$(GITLAB_URL)" ]; then \
		echo "Ошибка: Переменная GITLAB_URL не установлена."; \
		exit 1; \
	fi
	@if [ -z "$(GITLAB_TOKEN)" ]; then \
		echo "Ошибка: Переменная GITLAB_TOKEN не установлена."; \
		exit 1; \
	fi
	@if [ -z "$(GITLAB_GROUP)" ]; then \
		echo "Ошибка: Переменная GITLAB_GROUP не установлена."; \
		exit 1; \
	fi
	@if [ -z "$(CLONE_PATH)" ]; then \
		echo "Ошибка: Переменная CLONE_PATH не установлена."; \
		exit 1; \
	fi
	@echo "Все необходимые переменные окружения установлены."

# Сборка Docker-образа
build:
	@echo "Сборка Docker-образа..."
	docker build -t $(IMAGE_NAME) .

# Запуск скрипта через Docker
docker_run: build
	@echo "Запуск скрипта через Docker..."
	docker run --rm \
    	-v $SSH_AUTH_SOCK:/ssh-agent \
        -e SSH_AUTH_SOCK=/ssh-agent \
		--env GITLAB_URL=$(GITLAB_URL) \
		--env GITLAB_TOKEN=$(GITLAB_TOKEN) \
		--env GITLAB_GROUP=$(GITLAB_GROUP) \
		--env CLONE_PATH=/app/repositories \
		-v $(CLONE_PATH):/app/repositories \
		$(IMAGE_NAME)
