FROM node:26.13.1-slim AS base
COPY package.json /tmp/package.json
RUN npm install --global --force "$(node -p 'require("/tmp/package.json").packageManager.split("+")[0]')"

## Build ##
FROM base AS builder
WORKDIR /srv
COPY .oxfmtrc.jsonc tsconfig.json package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY database/package.json ./database/
COPY api/package.json ./api/
RUN pnpm install --frozen-lockfile --prod --filter @laundry-plugs/api...
COPY database ./database
COPY api ./api

## Run ##
FROM base
WORKDIR /srv/api
RUN useradd --system --uid 1001 hono
COPY --chown=hono --from=builder /srv /srv
USER hono
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["node_modules/.bin/tsx", "submodules/main/index.ts"]
