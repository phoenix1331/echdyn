FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/pnpm/corepack \
    npm_config_store_dir=/pnpm/store \
    NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate

# Pre-create volume mount points so named volumes inherit node ownership,
# and run as node (uid 1000) so files written to the bind mount match the host user
RUN mkdir -p /app/node_modules /app/apps/web/node_modules /app/apps/worker/node_modules \
        /app/packages/core/node_modules /pnpm/store \
    && chown -R node:node /app /pnpm

USER node

WORKDIR /app
