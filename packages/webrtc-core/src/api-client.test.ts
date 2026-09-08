import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiClient, ApiError } from './api-client.ts';

/**
 * The one behaviour worth pinning down: a rate-limit or abuse refusal
 * (phase-3a-production.md §3.1) carries its own plain-language text in the
 * response body, and this is what makes that text actually reach the user
 * instead of the generic "having trouble" line every other server error
 * already showed. The fallback path — no body, or a body from something
 * that is not this API — has to keep working too.
 */

/** Mirrors `turn.test.ts`'s own helper. */
function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test('a refusal with a plain-language body surfaces that message and code', async () => {
  await withFetch(
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'TOO_MANY_SESSIONS',
            userMessage:
              "You've started a lot of sessions recently. Please wait before starting another.",
          }),
          { status: 429 },
        ),
      ),
    async () => {
      const client = new ApiClient('http://api.test');
      await assert.rejects(client.createSession(), (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 429);
        assert.equal(err.code, 'TOO_MANY_SESSIONS');
        assert.match(err.message, /started a lot of sessions/);
        return true;
      });
    },
  );
});

test('a server error with no parseable body falls back to the generic message', async () => {
  await withFetch(
    () => Promise.resolve(new Response('not json', { status: 500 })),
    async () => {
      const client = new ApiClient('http://api.test');
      await assert.rejects(client.createSession(), (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 500);
        assert.equal(err.code, undefined);
        assert.match(err.message, /having trouble/);
        return true;
      });
    },
  );
});

test('a network failure and a server error read the same to the user', async () => {
  await withFetch(
    () => Promise.reject(new Error('ECONNREFUSED')),
    async () => {
      const client = new ApiClient('http://api.test');
      await assert.rejects(client.createSession(), (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 0);
        assert.match(err.message, /unreachable/);
        return true;
      });
    },
  );
});

test('a successful response is returned as-is', async () => {
  await withFetch(
    () =>
      Promise.resolve(
        new Response(JSON.stringify({ iceServers: [{ urls: 'stun:stun.example' }] }), {
          status: 200,
        }),
      ),
    async () => {
      const client = new ApiClient('http://api.test');
      const servers = await client.iceServers();
      assert.deepEqual(servers, [{ urls: 'stun:stun.example' }]);
    },
  );
});
