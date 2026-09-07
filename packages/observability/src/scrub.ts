/**
 * The one place every Sentry event passes through before it leaves this
 * project, on every surface — the code side of phase-2-reliability.md §2.6's
 * "no tokens, no join codes, no IP addresses, no screen content".
 *
 * Deliberately not typed against `@sentry/node`'s, `@sentry/react`'s or
 * `@sentry/electron`'s own `Event` type — the three differ in the fine
 * detail, and this walks the same shape (nested plain objects and arrays)
 * regardless of which SDK produced it. That keeps this file the one thing
 * that has to agree with all three, instead of three copies each agreeing
 * with one.
 */

/** Any key whose *name* alone is reason enough to drop what it holds. */
const REDACT_KEY = /token|secret|password|authoriz|cookie|ip[_-]?address/i;

/** `482 719` or `482719` — the six-digit join code, wherever it turns up as a bare value (architecture's join codes are never long-term secrets, but they are still a lookup key nothing external should see). */
const JOIN_CODE_VALUE = /^\d{3}\s?\d{3}$/;

/** IPv4, and a conservative IPv6 shape. Good enough to redact on sight, not meant to validate. */
const IP_LIKE = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi;

const REDACTED = '[redacted]';

function scrubString(value: string): string {
  if (JOIN_CODE_VALUE.test(value.trim())) return REDACTED;
  return value.replace(IP_LIKE, REDACTED);
}

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === 'object') {
    return scrubPlainObject(value as Record<string, unknown>);
  }
  return value;
}

function scrubPlainObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = REDACT_KEY.test(key) ? REDACTED : scrubValue(value);
  }
  return out;
}

/**
 * Scrubs the parts of a Sentry event that carry this project's own data —
 * `extra`, `contexts`, `tags`, breadcrumb `data`, `request`, `user`, and the
 * error/log message text itself — leaving the event's own structural fields
 * (exception type, stack frames, timestamp, SDK version) untouched: those
 * come from the SDK, never from anything this project passed in, so a token
 * or a code could not have ended up there.
 *
 * "No screen content" has no code-shaped test to write against it: nothing
 * in this project ever puts a captured frame, a `MediaStream`, or pixel data
 * into an error's context in the first place, by construction — an
 * `Error`'s own fields are a message and a stack, neither of which can hold
 * a video frame. What this function actually guards against is the same
 * three concrete things logging and the database already scrub for
 * (architecture §42): tokens, join codes, and addresses.
 */
export function scrubSentryEvent<T extends Record<string, unknown>>(event: T): T {
  const scrubbed: Record<string, unknown> = { ...event };

  for (const key of ['extra', 'contexts', 'tags'] as const) {
    const value = scrubbed[key];
    if (value !== null && typeof value === 'object') {
      scrubbed[key] = scrubPlainObject(value as Record<string, unknown>);
    }
  }

  const breadcrumbs = scrubbed['breadcrumbs'];
  if (Array.isArray(breadcrumbs)) {
    scrubbed['breadcrumbs'] = breadcrumbs.map((crumb: unknown) => {
      if (crumb === null || typeof crumb !== 'object') return crumb;
      const c = crumb as Record<string, unknown>;
      const data = c['data'];
      return data !== null && typeof data === 'object'
        ? { ...c, data: scrubPlainObject(data as Record<string, unknown>) }
        : c;
    });
  }

  const request = scrubbed['request'];
  if (request !== null && typeof request === 'object') {
    // Headers and cookies are dropped outright, not pattern-matched — a
    // header is exactly what it says it is, with no ambiguity worth a regex,
    // and one of them (Authorization) is a token by another name.
    const { headers: _headers, cookies: _cookies, ...rest } = request as Record<string, unknown>;
    scrubbed['request'] = scrubPlainObject(rest);
  }

  const user = scrubbed['user'];
  if (user !== null && typeof user === 'object') {
    const { ip_address: _ip, ...rest } = user as Record<string, unknown>;
    scrubbed['user'] = scrubPlainObject(rest);
  }

  if (typeof scrubbed['message'] === 'string') {
    scrubbed['message'] = scrubString(scrubbed['message']);
  }

  const exception = scrubbed['exception'];
  if (exception !== null && typeof exception === 'object' && 'values' in exception) {
    const values = (exception as { values?: unknown }).values;
    if (Array.isArray(values)) {
      scrubbed['exception'] = {
        ...exception,
        values: values.map((v: unknown) => {
          if (v === null || typeof v !== 'object') return v;
          const value = (v as { value?: unknown }).value;
          return typeof value === 'string' ? { ...v, value: scrubString(value) } : v;
        }),
      };
    }
  }

  return scrubbed as T;
}
