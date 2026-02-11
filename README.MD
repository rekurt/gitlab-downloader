# Gitlab Downloader

> **[English version](README.en.md)**

Инструмент для автоматического клонирования всех репозиториев из указанной группы GitLab, включая подгруппы. Локальная структура папок повторяет иерархию групп в GitLab.

## Возможности

- Рекурсивный обход групп и подгрупп
- Клонирование через HTTPS с персональным токеном GitLab
- Асинхронное клонирование (до 5 репозиториев параллельно)
- Повторные попытки с экспоненциальной задержкой при ошибках API
- Локальная структура папок, соответствующая иерархии GitLab

## Быстрый старт

### Требования

- Python 3.10+
- Git
- Персональный токен GitLab с правами `read_api` и `read_repository`

### Установка

```bash
make venv        # создать виртуальное окружение и установить зависимости
```

### Настройка

Создайте файл `.env` в корне проекта (см. `.env.example`):

```env
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=ваш_токен
GITLAB_GROUP=название_или_id_группы
CLONE_PATH=./repositories          # необязательно, по умолчанию ./repositories
```

### Запуск

```bash
make run         # запуск локально (проверит переменные окружения)
```

или напрямую:

```bash
python fetch_repositories.py
```

## Docker

```bash
make build       # собрать образ
make docker_run  # собрать и запустить контейнер
```

Контейнер монтирует `./repositories` и SSH-агент, переменные окружения прокидываются из `.env`.

## Получение токена GitLab

1. Войдите в аккаунт GitLab.
2. Перейдите в **Settings** → **Access Tokens** ([ссылка для gitlab.com](https://gitlab.com/-/profile/personal_access_tokens)).
3. Укажите имя токена и отметьте права:
   - `read_api` — чтение через API
   - `read_repository` — доступ к репозиториям
4. Нажмите **Create personal access token** и сохраните токен.

## Структура проекта

| Файл | Описание |
|------|----------|
| `fetch_repositories.py` | Основной скрипт (точка входа) |
| `Makefile` | Команды для запуска, сборки и Docker |
| `Dockerfile` | Сборка Docker-образа |
| `requirements.txt` | Зависимости Python (aiohttp, python-dotenv) |
| `.env.example` | Шаблон переменных окружения |

## Лицензия

MIT
