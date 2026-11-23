FROM node:26.13.1-slim AS base
COPY package.json /tmp/package.json
RUN npm install --global --force "$(node -p 'require("/tmp/package.json").packageManager.split("+")[0]')"

## Build ##
FROM base AS builder
WORKDIR /srv
COPY .oxfmtrc.jsonc tsconfig.json package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY database/package.json ./database/
RUN pnpm install --frozen-lockfile --prod --filter @laundry-plugs/database
COPY database ./database

## Run ##
FROM base
WORKDIR /srv/database
RUN useradd --system --uid 1001 migrator
COPY --chown=migrator --from=builder /srv /srv
USER migrator
ENV NODE_ENV=production
CMD ["node_modules/.bin/tsx", "src/migrator.ts"]
