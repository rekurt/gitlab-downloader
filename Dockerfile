FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY fetch_repositories.py .
COPY .env .

ENV PYTHONUNBUFFERED=1

CMD ["python3", "fetch_repositories.py"]
