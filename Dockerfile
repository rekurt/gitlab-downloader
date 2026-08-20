FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs git-filter-repo ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 appuser
WORKDIR /app

COPY package.json package-lock.json ./
COPY lib/package.json ./lib/package.json
COPY cli/package.json ./cli/package.json
COPY electron/package.json ./electron/package.json
RUN npm ci --omit=dev --workspace @gitlab-dump/core --workspace gitlab-dump-cli

COPY lib ./lib
COPY cli ./cli
RUN mkdir -p /app/repositories && chown -R appuser:appuser /app

USER appuser
ENTRYPOINT ["node", "cli/bin/gitlab-dump.js"]
CMD ["clone", "--help"]
