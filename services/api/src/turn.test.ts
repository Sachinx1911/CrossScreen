import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TurnCredentialSource } from './turn.ts';

/**
 * The two properties that matter here are not really about Cloudflare's API
 * shape: that a credential is cached rather than fetched on every single
 * request, and that a failure to reach Cloudflare degrades to STUN-only
 * rather than breaking the endpoint every caller depends on.
 */

function fakeLog() {
  const lines: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  const record =
    (level: string) =>
    (event: string, fields?: Record<string, unknown>): void => {
      lines.push({ level, event, ...(fields === undefined ? {} : { fields }) });
    };
  return {
    lines,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}

/** Stand in for global fetch, restored afterward — mirrors the navigator stub in browser-capture.test.ts. */
function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function cloudflareResponse(
  overrides: Partial<{ urls: string[]; username: string; credential: string }> = {},
) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        iceServers: [
          {
            urls: overrides.urls ?? ['turn:turn.cloudflare.com:3478?transport=udp'],
            username: overrides.username ?? 'the-username',
            credential: overrides.credential ?? 'the-credential',
          },
        ],
      }),
  } as Response;
}

const CONFIG = { keyId: 'key-id', apiToken: 'api-token', ttlSeconds: 3600 };

test('no configuration means STUN-only, and one loud warning rather than silence', async () => {
  const { lines, logger } = fakeLog();
  const source = new TurnCredentialSource(undefined, logger);

  assert.equal(await source.get(), undefined);
  const warning = lines.find((l) => l.event === 'turn.not_configured');
  assert.ok(warning, 'silence here would let a deployment run STUN-only for weeks unnoticed');
});

test('a minted credential is returned to the caller', async () => {
  const { logger } = fakeLog();
  let calls = 0;

  await withFetch(
    () => {
      calls += 1;
      return Promise.resolve(cloudflareResponse());
    },
    async () => {
      const source = new TurnCredentialSource(CONFIG, logger);
      const servers = await source.get();

      assert.equal(calls, 1);
      assert.equal(servers?.length, 1);
      assert.equal(servers?.[0]?.username, 'the-username');
      assert.equal(servers?.[0]?.credential, 'the-credential');
      assert.deepEqual(servers?.[0]?.urls, ['turn:turn.cloudflare.com:3478?transport=udp']);
    },
  );
});

test('a fresh credential is cached rather than fetched on every call', async () => {
  // The endpoint this backs is asked by every sharer and every viewer at the
  // start of every session — asking Cloudflare fresh each time would multiply
  // request volume for no benefit a short TTL does not already provide.
  const { logger } = fakeLog();
  let calls = 0;

  await withFetch(
    () => {
      calls += 1;
      return Promise.resolve(cloudflareResponse());
    },
    async () => {
      const source = new TurnCredentialSource(CONFIG, logger);
      const now = Date.now();

      await source.get(now);
      await source.get(now + 1_000);
      await source.get(now + 60_000);

      assert.equal(calls, 1, 'three calls inside the TTL should be one fetch');
    },
  );
});

test('a credential is refetched once it nears expiry, ahead of actually lapsing', async () => {
  const { logger } = fakeLog();
  let calls = 0;

  await withFetch(
    () => {
      calls += 1;
      return Promise.resolve(cloudflareResponse());
    },
    async () => {
      const source = new TurnCredentialSource(CONFIG, logger);
      const now = Date.now();

      await source.get(now);
      // Inside the refresh margin (5 minutes) of a 1-hour TTL, but not yet
      // actually expired — this is exactly the case the margin exists for.
      await source.get(now + CONFIG.ttlSeconds * 1_000 - 60_000);

      assert.equal(calls, 2, 'refetched ahead of expiry, not exactly at it');
    },
  );
});

test('concurrent requests during a refetch share one fetch, not one each', async () => {
  const { logger } = fakeLog();
  let calls = 0;

  await withFetch(
    () => {
      calls += 1;
      return Promise.resolve(cloudflareResponse());
    },
    async () => {
      const source = new TurnCredentialSource(CONFIG, logger);
      await Promise.all([source.get(), source.get(), source.get()]);

      assert.equal(calls, 1, 'three requests racing the first fetch must not each start their own');
    },
  );
});

test('Cloudflare refusing the request falls back to STUN-only, and does not throw', async () => {
  const { logger } = fakeLog();

  await withFetch(
    () => Promise.resolve({ ok: false, status: 401 } as Response),
    async () => {
      const source = new TurnCredentialSource(CONFIG, logger);
      assert.equal(await source.get(), undefined);
    },
  );
});

test('a network failure reaching Cloudflare falls back to STUN-only, and does not throw', async () => {
  const { logger } = fakeLog();

  await withFetch(
    () => Promise.reject(new Error('getaddrinfo ENOTFOUND rtc.live.cloudflare.com')),
    async () => {
      const source = new TurnCredentialSource(CONFIG, logger);
      await assert.doesNotReject(() => source.get());
      assert.equal(await source.get(), undefined);
    },
  );
});

test('a network failure after a credential was already cached serves the stale one', async () => {
  // A slightly-stale credential is far better than none, and STUN-only is
  // worse still — the whole reason TURN exists is the networks where it is
  // the only path that works at all.
  const { logger } = fakeLog();
  let fail = false;

  await withFetch(
    () =>
      fail ? Promise.reject(new Error('network down')) : Promise.resolve(cloudflareResponse()),
    async () => {
      const source = new TurnCredentialSource(CONFIG, logger);
      const now = Date.now();

      const first = await source.get(now);
      assert.ok(first);

      fail = true;
      // Past the refresh margin, so a refetch is attempted and fails.
      const second = await source.get(now + CONFIG.ttlSeconds * 1_000 - 60_000);
      assert.deepEqual(second, first, 'the stale credential is still served');
    },
  );
});

test('a response with no usable server falls back rather than handing back nothing useful', async () => {
  const { logger } = fakeLog();

  await withFetch(
    () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ iceServers: [] }),
      } as Response),
    async () => {
      const source = new TurnCredentialSource(CONFIG, logger);
      assert.equal(await source.get(), undefined);
    },
  );
});
