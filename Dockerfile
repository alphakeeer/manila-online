# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/game/package.json packages/game/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV WEB_DIST_DIR=/app/dist
RUN addgroup -S manila && adduser -S manila -G manila
COPY --from=build --chown=manila:manila /app/node_modules ./node_modules
COPY --from=build --chown=manila:manila /app/dist ./dist
COPY --chown=manila:manila package.json tsconfig.json ./
COPY --chown=manila:manila apps/server ./apps/server
COPY --chown=manila:manila packages ./packages
USER manila
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
