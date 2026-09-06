import { useState } from 'react';

import { Button, Notice } from './Primitives.tsx';

const STORAGE_KEY = 'crossscreen.seen-safety-notice';

/**
 * Shown before someone's first share, once.
 *
 * Public screen-sharing services are a standard vector for tech-support scams,
 * and a tool that lets a stranger watch a desktop has an obligation to say so
 * before it is used rather than after. Required by architecture §7 and
 * ui-scope.md §3.2.
 *
 * Once, not every time: a warning people have learned to click through is
 * worse than none, because it trains the reflex it is trying to interrupt.
 */
export function useSafetyNotice(): { needed: boolean; acknowledge: () => void } {
  const [needed, setNeeded] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === null;
    } catch {
      // Private browsing, or storage disabled. Showing it again is the safe
      // way to be wrong.
      return true;
    }
  });

  return {
    needed,
    acknowledge: () => {
      try {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch {
        /* nothing to do; it will be shown again */
      }
      setNeeded(false);
    },
  };
}

/** Settings' "show it again" — the only way back to a warning acknowledged once. */
export function forgetSafetyNoticeSeen(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do; it was already going to be shown again */
  }
}

export function SafetyNotice({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div className="space-y-4">
      <Notice tone="warning">
        <strong className="block">Only share with people you know.</strong>
        Whoever you allow will see everything on the screen you share — messages, email, anything
        you open. CrossScreen will never ask you to share your screen with support staff.
      </Notice>
      <Button onClick={onAcknowledge}>I understand</Button>
    </div>
  );
}
