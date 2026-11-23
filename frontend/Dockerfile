FROM node:26.13.1-slim AS builder
WORKDIR /srv
COPY package.json /tmp/package.json
RUN npm install --global --force "$(node -p 'require("/tmp/package.json").packageManager.split("+")[0]')"
COPY .oxfmtrc.jsonc tsconfig.json package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY database/package.json ./database/
COPY api/package.json ./api/
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile --filter @laundry-plugs/frontend...
COPY database ./database
COPY api ./api
COPY frontend ./frontend
WORKDIR /srv/frontend
RUN pnpm exec quasar build

FROM nginx:1.29-alpine
COPY --from=builder /srv/frontend/dist/spa /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
