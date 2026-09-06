const STORAGE_KEY = 'crossscreen.recent-sessions';
const MAX_ENTRIES = 5;

/**
 * A local log of screens this device has shared.
 *
 * ui-scope.md §1 C3: kept from the mockup, but backed by `localStorage`
 * only — per-device, never synced, cleared with browser data, and never
 * implying an account exists (ADR-0007). Shared between the web and
 * desktop apps so the storage format cannot drift between them, the same
 * reason this package exists at all.
 *
 * A session's join code stops working well before this list would be worth
 * clicking to rejoin from — `SESSION_TIMEOUTS.idleMs` is minutes, this list
 * is not pruned by time. It is a record of what happened, not a shortcut
 * back into it.
 */
export interface RecentSession {
  joinCode: string;
  joinCodeDisplay: string;
  startedAt: number;
}

export function recordSharedSession(
  session: { joinCode: string; joinCodeDisplay: string },
  now = Date.now(),
): void {
  try {
    const next = [{ ...session, startedAt: now }, ...readRecentSessions()].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing, or storage disabled or full. Losing the entry is
    // fine — this is a convenience list, nothing downstream depends on it.
  }
}

export function readRecentSessions(): RecentSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentSession) : [];
  } catch {
    // Corrupted or inaccessible storage reads as "no history", not an error
    // — there is nothing a user could do with that failure anyway.
    return [];
  }
}

/** Settings' "clear history" — the only way to remove this once it exists. */
export function clearRecentSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do; there was nothing readable to begin with */
  }
}

function isRecentSession(value: unknown): value is RecentSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['joinCode'] === 'string' &&
    typeof v['joinCodeDisplay'] === 'string' &&
    typeof v['startedAt'] === 'number'
  );
}
