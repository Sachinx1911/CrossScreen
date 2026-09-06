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

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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
      throw new ApiError('CrossScreen is having trouble. Please try again.', response.status);
    }
    return (await response.json()) as T;
  }
}
