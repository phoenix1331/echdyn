FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate

WORKDIR /app
