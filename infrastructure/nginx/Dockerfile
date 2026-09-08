# Builds the web viewer and serves it, and reverse-proxies to api/signaling
# — see templates/default.conf.template for the actual routing.
#
#   docker build -f infrastructure/nginx/Dockerfile \
#     --build-arg VITE_API_URL=https://api.example.com \
#     --build-arg VITE_SIGNALING_URL=wss://signal.example.com \
#     -t crossscreen-nginx .
#
# The two ARGs are load-bearing, not cosmetic: Vite bakes them into the
# built JS at this step, not read at runtime (`apps/web/src/config.ts`), so
# this image has to be rebuilt whenever the domain changes — there is no
# "reconfigure without rebuilding" here. Omitted, the web app falls back to
# same-origin (`location.origin`), which is wrong for the three-subdomain
# layout this compose stack actually uses.

FROM node:22-alpine AS web-builder
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
ARG VITE_API_URL
ARG VITE_SIGNALING_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SIGNALING_URL=${VITE_SIGNALING_URL}
RUN npx turbo run build --filter=@crossscreen/web...

FROM nginx:1.27-alpine
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html
COPY infrastructure/nginx/templates /etc/nginx/templates
# Restricts envsubst (nginx's own docker-entrypoint runs it on every
# *.template file) to only this one variable — nginx's own runtime
# variables in the template ($http_upgrade, $host, $scheme, ...) share the
# same $-syntax and would otherwise be substituted away into empty strings
# the moment the container starts.
ENV NGINX_ENVSUBST_FILTER=DOMAIN

EXPOSE 80 443
