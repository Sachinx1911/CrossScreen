import { createHmac } from 'node:crypto';

/**
 * Turn an address into something countable but not identifying.
 *
 * Rate limiting and abuse detection need to know that two requests came from
 * the same place. Neither needs to know where that is. A keyed hash gives the
 * first without the second, and truncating it further limits what a leaked
 * database would reveal.
 *
 * Keyed rather than plain: the address space is small enough that an unkeyed
 * hash of every IPv4 address can be precomputed in minutes, which would make
 * the hashing decorative.
 */
export function hashIp(ip: string | undefined, secret: string): string | undefined {
  if (ip === undefined || ip === '') return undefined;
  return createHmac('sha256', secret).update(ip).digest('base64url').slice(0, 22);
}
