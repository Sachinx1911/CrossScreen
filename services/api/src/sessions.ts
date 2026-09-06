import {
  createSessionIdentifiers,
  formatJoinCode,
  signHostToken,
  type HostTokenClaims,
} from '@crossscreen/protocol';

import { config } from './config.ts';

/**
 * Session creation.
 *
 * This service mints identifiers and a signed token and keeps nothing (ADR-0011).
 * The live session begins when the host attaches to signaling, so `api` can
 * restart mid-session without disturbing anyone.
 */

export interface CreatedSession {
  /**
   * Internal, and stripped before the response is sent. It exists here only so
   * that the request handler can record the event against it — architecture §7
   * keeps this identifier off the wire.
   */
  sessionId: string;
  /** Six digits, unformatted — the display grouping is the client's business. */
  joinCode: string;
  /** Ready to show, `482 719`. */
  joinCodeDisplay: string;
  /** 128 bits, carried in the share link. */
  joinToken: string;
  shareLink: string;
  /** Proves authorship of this session to signaling. Never shown to a viewer. */
  hostToken: string;
  expiresAt: number;
}

export async function createSession(now = Date.now()): Promise<CreatedSession> {
  const ids = createSessionIdentifiers(now);

  const claims: HostTokenClaims = {
    sid: ids.sessionId,
    code: ids.joinCode,
    tok: ids.joinToken,
    // JWT convention is seconds, and getting this wrong in either direction
    // either expires every session immediately or never.
    iat: Math.floor(ids.createdAt / 1000),
    exp: Math.floor(ids.expiresAt / 1000),
  };

  return {
    sessionId: ids.sessionId,
    joinCode: ids.joinCode,
    joinCodeDisplay: formatJoinCode(ids.joinCode),
    joinToken: ids.joinToken,
    shareLink: `${config.appOrigin.replace(/\/+$/, '')}/j/${ids.joinToken}`,
    hostToken: await signHostToken(claims, config.sessionSecret),
    expiresAt: ids.expiresAt,
  };
}

/**
 * ICE servers for a client to use.
 *
 * Clients read this rather than hardcoding a provider, so moving from
 * Cloudflare to coturn later is a server configuration change instead of a
 * release of five clients (ADR-0004).
 */
export function iceServers(): RTCIceServerConfig[] {
  const servers: RTCIceServerConfig[] = [{ urls: config.stunUrls }];

  if (config.turnUrls.length > 0 && config.turnUsername !== '') {
    servers.push({
      urls: config.turnUrls,
      username: config.turnUsername,
      credential: config.turnCredential,
    });
  }
  return servers;
}

/** The shape `RTCPeerConnection` expects, without pulling in the DOM lib. */
export interface RTCIceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}
