FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 10001 appuser

WORKDIR /app
COPY pyproject.toml .
COPY fetch_repositories.py .
COPY gitlab_downloader ./gitlab_downloader
RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1
USER appuser

ENTRYPOINT ["gitlab-dump"]
CMD []
