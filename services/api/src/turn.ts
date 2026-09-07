import type { Logger } from '@crossscreen/logging';

import type { RTCIceServerConfig } from './sessions.ts';

/**
 * Short-lived TURN credentials, minted from Cloudflare on demand.
 *
 * Phase 0.5's finding was that TURN is not optional — a PC and a phone on
 * mobile data could find no direct path at all. What this closes is the
 * corner that was left manual after that: a 24-hour credential fetched by
 * hand with `pnpm turn` and written to a file, rather than the service
 * minting its own. ADR-0004's whole point is that clients never see a
 * provider's long-term secret; a credential sitting in `.env.local` for a day
 * was already most of the way there, but "most of the way" is not the same
 * claim as "short-lived".
 *
 * The long-term key (`CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN`)
 * never leaves this process. What a client receives from
 * `GET /api/v1/ice-servers` is a credential Cloudflare itself issued with a
 * short expiry, scoped to nothing but relaying.
 */

export interface CloudflareTurnConfig {
  keyId: string;
  apiToken: string;
  /** How long a minted credential is valid for. */
  ttlSeconds: number;
}

interface CachedCredential {
  servers: RTCIceServerConfig[];
  /** When Cloudflare says this credential stops working. */
  expiresAt: number;
}

/**
 * Refetch this far ahead of actual expiry, so a client that requests ice
 * servers in the last moments of a cached credential's life is never handed
 * one that could expire mid-negotiation.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1_000;

/**
 * Mints and caches one credential at a time for the whole service.
 *
 * Not one per request: `GET /api/v1/ice-servers` is called by every sharer
 * and every viewer at the start of every session, and asking Cloudflare fresh
 * on each of those would multiply request volume for no benefit — every
 * caller in the same few minutes can safely share one credential, since its
 * short lifetime is what makes it short-lived, not how many callers hold it.
 */
export class TurnCredentialSource {
  readonly #config: CloudflareTurnConfig | undefined;
  readonly #log: Logger;
  #cached: CachedCredential | undefined;
  /** So concurrent requests during a refetch share one fetch, not one each. */
  #inFlight: Promise<CachedCredential | undefined> | undefined;

  constructor(config: CloudflareTurnConfig | undefined, log: Logger) {
    this.#config = config;
    this.#log = log;
    if (config === undefined) {
      // Loud, once, at startup — not on every request. Silence here would let
      // a production deployment serve STUN-only for weeks before anyone
      // noticed why direct-only connections were failing on strict NATs.
      log.warn('turn.not_configured', {
        hint: 'CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_API_TOKEN are not set. Only STUN will be offered.',
      });
    }
  }

  /**
   * The current TURN servers, or `undefined` if none are configured or
   * Cloudflare could not be reached. Never throws: a client that cannot get a
   * TURN credential should fall back to STUN-only, not fail outright — a
   * connection between two friendly networks does not need TURN at all.
   */
  async get(now = Date.now()): Promise<RTCIceServerConfig[] | undefined> {
    if (this.#config === undefined) return undefined;

    if (this.#cached !== undefined && this.#cached.expiresAt - now > REFRESH_MARGIN_MS) {
      return this.#cached.servers;
    }

    this.#inFlight ??= this.#fetch(this.#config, now).finally(() => {
      this.#inFlight = undefined;
    });
    const fetched = await this.#inFlight;
    return fetched?.servers;
  }

  async #fetch(
    turnConfig: CloudflareTurnConfig,
    now: number,
  ): Promise<CachedCredential | undefined> {
    let response: Response;
    try {
      response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${turnConfig.keyId}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${turnConfig.apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ ttl: turnConfig.ttlSeconds }),
        },
      );
    } catch (err) {
      // A network problem reaching Cloudflare, not a rejection by it. Serve
      // whatever was cached even if it is past its own refresh margin — a
      // slightly-stale credential is far better than none, and STUN-only is
      // worse still.
      this.#log.warn('turn.fetch_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      return this.#cached;
    }

    if (!response.ok) {
      this.#log.warn('turn.fetch_refused', { status: response.status });
      return this.#cached;
    }

    const body = (await response.json()) as { iceServers?: unknown };
    const raw = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
    const servers = raw
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => toIceServer(s))
      .filter((s): s is RTCIceServerConfig => s !== undefined);

    if (servers.length === 0) {
      this.#log.warn('turn.fetch_empty', {});
      return this.#cached;
    }

    const credential: CachedCredential = {
      servers,
      expiresAt: now + turnConfig.ttlSeconds * 1_000,
    };
    this.#cached = credential;
    this.#log.info('turn.credential_minted', {
      ttlSeconds: turnConfig.ttlSeconds,
      urlCount: servers.reduce((n, s) => n + s.urls.length, 0),
    });
    return credential;
  }
}

function toIceServer(raw: Record<string, unknown>): RTCIceServerConfig | undefined {
  const urls = Array.isArray(raw['urls'])
    ? raw['urls'].filter((u): u is string => typeof u === 'string')
    : typeof raw['urls'] === 'string'
      ? [raw['urls']]
      : [];
  if (urls.length === 0) return undefined;

  const server: RTCIceServerConfig = { urls };
  if (typeof raw['username'] === 'string') server.username = raw['username'];
  if (typeof raw['credential'] === 'string') server.credential = raw['credential'];
  return server;
}
