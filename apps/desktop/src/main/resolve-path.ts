import { join, normalize, sep } from 'node:path';

/**
 * Path resolution for the `app://` handler, kept apart from it on purpose.
 *
 * Nothing here imports Electron, so the rule this file encodes can be tested
 * by plain `node --test` in CI, where no Electron binary is downloaded. A
 * security check with no test is a security check that quietly stops working.
 */

/**
 * Resolve a request path to a file inside `root`, refusing anything that
 * escapes it. The renderer is bundled and trusted, but a protocol handler is
 * an entry point, and one that will happily read `../../../etc/passwd` if
 * asked is a bug waiting to be found by someone else.
 *
 * It is the second line rather than the first, which is worth knowing before
 * anyone decides it is redundant and removes it. The URL parser collapses `..`
 * segments before `pathname` is ever read, and it decodes `%2e%2e` first, so
 * both spellings of that attack arrive already flattened to `/etc/passwd` and
 * fail further down by simply not existing inside `root`. This check is what
 * still holds if a future change reads the path from somewhere that has not
 * been through a URL parser.
 *
 * Returns null for anything that should be refused rather than served.
 */
export function resolveWithin(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    // Throws URIError on a malformed escape — `%`, `%zz`, a truncated `%2`.
    // The URL parser leaves those in the pathname rather than rejecting them,
    // so they arrive here intact, and this used to throw out of the protocol
    // handler as an unhandled rejection instead of answering the request.
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const relative = decoded === '/' || decoded === '' ? '/index.html' : decoded;
  const resolved = normalize(join(root, relative));
  if (resolved !== root && !resolved.startsWith(root + sep)) return null;
  return resolved;
}
