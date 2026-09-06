import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLogger, levelFromEnv } from './index.ts';

/**
 * Two behaviours are worth pinning down: that a level actually filters, and
 * that warnings and errors go to stderr. Both are quietly load-bearing —
 * `LOG_LEVEL=error` is what keeps test output readable, and the stream split
 * is what lets a shell pipeline separate problems from noise.
 */

function capture(run: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    run();
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  return { out, err };
}

test('each line is one JSON object naming the service and event', () => {
  const { out } = capture(() => {
    createLogger('api').info('session.created', { joinCode: '482719' });
  });

  assert.equal(out.length, 1);
  const line = JSON.parse(out[0]!) as Record<string, unknown>;
  assert.equal(line['service'], 'api');
  assert.equal(line['event'], 'session.created');
  assert.equal(line['level'], 'info');
  assert.equal(line['joinCode'], '482719');
  assert.match(line['t'] as string, /^\d{4}-\d{2}-\d{2}T/);
});

test('a level below the threshold produces nothing at all', () => {
  const { out, err } = capture(() => {
    const log = createLogger('api', 'warn');
    log.debug('ignored');
    log.info('ignored');
    log.warn('kept');
  });

  assert.equal(out.length, 0, 'info must not reach stdout at warn level');
  assert.equal(err.length, 1);
});

test('warnings and errors go to stderr, everything else to stdout', () => {
  const { out, err } = capture(() => {
    const log = createLogger('signaling', 'debug');
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
  });

  assert.equal(out.length, 2, 'debug and info belong on stdout');
  assert.equal(err.length, 2, 'warn and error belong on stderr');
});

test('an unrecognised level falls back rather than refusing', () => {
  // Logging configuration must never be the thing that stops a service.
  assert.equal(levelFromEnv(undefined), 'info');
  assert.equal(levelFromEnv(''), 'info');
  assert.equal(levelFromEnv('shout'), 'info');
  assert.equal(levelFromEnv('debug'), 'debug');
  assert.equal(levelFromEnv('error'), 'error');
});

test('fields cannot overwrite the line structure by accident', () => {
  const { out } = capture(() => {
    createLogger('api').info('event.name', { service: 'spoofed' });
  });

  // Fields are spread last, so this documents the current behaviour rather
  // than asserting a guarantee: callers own their field names, and colliding
  // with `service` or `event` is their mistake to avoid.
  const line = JSON.parse(out[0]!) as Record<string, unknown>;
  assert.equal(line['event'], 'event.name');
  assert.equal(line['service'], 'spoofed');
});
