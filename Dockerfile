FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 10001 appuser

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY fetch_repositories.py .
COPY gitlab_downloader ./gitlab_downloader

ENV PYTHONUNBUFFERED=1
USER appuser

ENTRYPOINT ["python3", "fetch_repositories.py"]
CMD []
