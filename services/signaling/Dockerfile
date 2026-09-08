# The mirror of services/api/Dockerfile — see that file's comments for the
# reasoning behind every choice here, which applies unchanged.
#
#   docker build -f services/signaling/Dockerfile -t crossscreen-signaling .

FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY services/api/package.json services/api/package.json
COPY services/signaling/package.json services/signaling/package.json
COPY tests/e2e/package.json tests/e2e/package.json
COPY packages/capture/package.json packages/capture/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/logging/package.json packages/logging/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/rate-limit/package.json packages/rate-limit/package.json
COPY packages/webrtc-core/package.json packages/webrtc-core/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN npx turbo run build --filter=@crossscreen/signaling...

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S crossscreen && adduser -S crossscreen -G crossscreen
COPY --from=builder --chown=crossscreen:crossscreen /app /app
USER crossscreen

EXPOSE 8787
CMD ["node", "--env-file-if-exists=.env.local", "services/signaling/src/server.ts"]
