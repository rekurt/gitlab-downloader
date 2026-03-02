FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 10001 appuser

WORKDIR /app
COPY lib ./lib
COPY cli ./cli
RUN npm install --prefix lib && npm install --prefix cli

USER appuser

ENTRYPOINT ["node", "cli/bin/gitlab-dump.js"]
CMD []
