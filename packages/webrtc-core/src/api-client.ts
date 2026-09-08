/**
 * The HTTP side of the API, for clients.
 *
 * Small on purpose: creating a session and asking where the ICE servers are.
 * Clients never hardcode a TURN provider — that is the whole point of the
 * endpoint (ADR-0004), and it is why moving from Cloudflare to coturn later
 * does not mean releasing five clients.
 */

export interface CreatedSession {
  joinCode: string;
  joinCodeDisplay: string;
  joinToken: string;
  shareLink: string;
  hostToken: string;
  expiresAt: number;
}

export class ApiError extends Error {
  readonly status: number;
  /** The protocol `ErrorCode`, when the API returned one — `undefined` for a plain network failure or a response with no recognisable body. */
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  async createSession(): Promise<CreatedSession> {
    return this.#request<CreatedSession>('POST', '/api/v1/sessions');
  }

  async iceServers(): Promise<RTCIceServer[]> {
    const body = await this.#request<{ iceServers: RTCIceServer[] }>('GET', '/api/v1/ice-servers');
    return body.iceServers;
  }

  async #request<T>(method: string, path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl.replace(/\/+$/, '')}${path}`, {
        method,
        headers: { accept: 'application/json' },
      });
    } catch {
      // A network failure and a server error need the same words here: the
      // user cannot tell them apart and cannot act differently on them.
      throw new ApiError('CrossScreen is unreachable. Check your connection.', 0);
    }

    if (!response.ok) {
      // Rate limiting and abuse refusals (phase-3a-production.md §3.1) carry
      // their own plain-language text in the body — { error, userMessage } —
      // the same shape every WebSocket error already uses. Falling back to
      // the generic line covers a response with no body at all, or one from
      // something that is not this API (a proxy's own error page, say).
      const body = (await response.json().catch(() => undefined)) as
        { error?: string; userMessage?: string } | undefined;
      throw new ApiError(
        body?.userMessage ?? 'CrossScreen is having trouble. Please try again.',
        response.status,
        body?.error,
      );
    }
    return (await response.json()) as T;
  }
}
