# Built from the repository root — see infrastructure/docker-compose.prod.yml,
# which is the only thing that should ever invoke this:
#
#   docker build -f services/api/Dockerfile -t crossscreen-api .
#
# Two stages, not because the image needs to be small — it does not, this is
# a solo project's one VPS, not a container fleet — but because `node
# src/server.ts` at runtime still needs the *built* dist/ output of the
# workspace packages it imports (`@crossscreen/db` etc. resolve through
# their own package.json `main`, which points at dist/), and a runtime image
# with the whole TypeScript toolchain in it to produce that is a needless
# thing to ship.
#
# The whole monorepo is copied into the builder stage rather than
# cherry-picking files: pnpm workspaces resolve through symlinks in
# node_modules, and reconstructing that correctly by hand is exactly the
# kind of clever that breaks on the next dependency added. `pnpm deploy`'s
# pruning is the size-optimised version of this — worth it if this image's
# size ever actually becomes a problem, not before.

FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
# Every pnpm-workspace.yaml member's package.json, not only the ones this
# service needs — `pnpm install --frozen-lockfile` checks the *complete*
# workspace shape against the lockfile, so a partial copy here fails the
# install before this service's own dependencies even come into it.
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
# Installs the whole workspace's dependencies, `apps/desktop`'s Electron
# download included, even though this image needs none of it — the price
# of `--frozen-lockfile` insisting on the complete, correct shape. Worth
# trading for a smaller image later if build time on this ever matters;
# not before.
RUN pnpm install --frozen-lockfile

COPY . .
# turbo's own filter, not pnpm's: `pnpm --filter X build` would only run X's
# own `tsc -b` and skip everything `dependsOn: ["^build"]` (turbo.json) means
# by "build its dependencies first" — turbo is the thing that actually knows
# that graph.
RUN npx turbo run build --filter=@crossscreen/api...

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Runs as an ordinary user, not root — the image ships nothing that needs
# root once dependencies are already installed.
RUN addgroup -S crossscreen && adduser -S crossscreen -G crossscreen
COPY --from=builder --chown=crossscreen:crossscreen /app /app
USER crossscreen

EXPOSE 8788
# `--env-file-if-exists` no-ops when the file is absent, which it is here —
# production configuration arrives as real environment variables from
# docker-compose, the same code path development already uses for `.env.local`.
CMD ["node", "--env-file-if-exists=.env.local", "services/api/src/server.ts"]
