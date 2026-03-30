FROM node:22-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/scanner/package.json packages/scanner/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/scanner/tsconfig.json packages/scanner/tsconfig.json
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json

RUN pnpm install --frozen-lockfile

COPY packages/scanner/src packages/scanner/src
COPY packages/shared/src packages/shared/src

RUN pnpm --filter @skillshield/shared build && pnpm --filter @skillshield/scanner build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV="production"
ENV PORT="3100"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    python3 \
    python3-pip \
    tar \
    unzip \
    zip \
  && python3 -m pip install --break-system-packages --no-cache-dir cisco-ai-skill-scanner \
  && npm install --global tsx@4.20.6 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared /app/packages/shared
COPY --from=build /app/packages/scanner /app/packages/scanner

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "const port = process.env.PORT || '3100'; fetch(`http://127.0.0.1:${port}/health`).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["tsx", "packages/scanner/src/index.ts"]
