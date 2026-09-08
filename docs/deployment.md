# Deployment

Phase 3a §3.4: Docker Compose on a single VPS, chosen for the same reason
every other decision in this project was — nothing self-hosted that a free
tier can do, and no more infrastructure than the traffic actually justifies.

```
nginx (TLS, reverse proxy)
  ├── api        (Fastify)
  ├── signaling  (ws)
  └── postgres
```

Three subdomains, one nginx container playing all three roles
(`infrastructure/nginx/templates/default.conf.template`): `app.` serves the
built web viewer, `api.` and `signal.` reverse-proxy to the two Node
services. Cloudflare sits in front for DNS; Let's Encrypt, via certbot,
issues the certificate the origin itself terminates TLS with.

## Before any of this

1. **A domain.** ADR-0010 is still open — `crossscreen.app`'s availability
   and trademark status were never checked. Resolve that first; everything
   below assumes you have one.
2. **A VPS**, Mumbai region for round-trip time to the initial user base.
   Any provider that gives you a public IPv4 address and root access is
   enough — this stack asks nothing provider-specific of it.
3. **Docker and the Compose plugin** installed on the VPS.
   `docker compose version` should print something; if it prints "command
   not found", you have the older standalone `docker-compose` and need to
   install the plugin instead.

## First deploy

On the VPS, as whatever user has Docker access:

```bash
git clone https://github.com/Sachinx1911/CrossScreen.git
cd CrossScreen
cp infrastructure/.env.example infrastructure/.env
# Edit infrastructure/.env: DOMAIN, SESSION_SECRET (openssl rand -base64 32),
# POSTGRES_PASSWORD, and the two Cloudflare TURN values if you have them yet.
```

**Point DNS before going further.** Three A records — `app.<DOMAIN>`,
`api.<DOMAIN>`, `signal.<DOMAIN>` — at this VPS's IP. Certbot's HTTP-01
challenge needs each one to actually resolve here; running it before DNS
propagates just fails and costs nothing but a retry once it does.

```bash
docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env up -d --build
```

This starts everything over **plain HTTP** — the TLS server blocks in
`default.conf.template` are commented out on purpose, because there is no
certificate to terminate with yet, and nginx refusing to start on a missing
cert file would be a worse first boot than serving HTTP for five minutes.

## Bootstrapping the certificate

The `certbot` service in the compose file only _renews_ an existing
certificate; issuing the first one is a one-time manual step, because it
needs different certbot arguments (`certonly`, not `renew`) and there is
nothing to renew until it has run once:

```bash
docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env run --rm certbot \
  certbot certonly --webroot -w /var/www/certbot \
  -d app.<DOMAIN> -d api.<DOMAIN> -d signal.<DOMAIN> \
  --email you@example.com --agree-tos --no-eff-email
```

Then uncomment the four `server { listen 443 ssl; ... }` blocks at the
bottom of `infrastructure/nginx/templates/default.conf.template`, and:

```bash
docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env up -d --build nginx
```

The long-running `certbot` service picks up renewal from here — nothing
further to schedule.

## A restart of the VPS must bring everything back without manual steps

Every service in the compose file is `restart: unless-stopped`, and
`docker compose up -d` itself does not need to be re-run after a reboot as
long as the Docker daemon is set to start on boot (`systemctl enable
docker` on most distributions) — Docker restarts anything that was running
when it stopped. This is exit criterion 8, and is the reason `restart:
unless-stopped` is on every service rather than left at the default `no`.

## What is verified here, and what is not

The compose file's syntax, variable interpolation, and required-variable
checks (`SESSION_SECRET`, `POSTGRES_PASSWORD`, `DOMAIN` all refuse to start
silently blank) are confirmed with `docker compose config` — real,
run-on-this-machine verification.

**Not verified**: that the Dockerfiles actually build, that the built
images actually start and pass their health checks, or that the whole
stack answers a real share-and-join flow through nginx — Docker Desktop
would not finish starting its backend on the machine this was written on
(the same class of environment gap as `packages/db/src/retention.ts` in
§3.3). Nor has the certbot bootstrap ever run against a real domain — there
is no domain yet to run it against (ADR-0010). Both are the next honest
steps before this phase is called proven rather than merely written, the
same distinction phase-2-reliability.md's own entries have already drawn
more than once.
