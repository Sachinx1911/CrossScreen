import { useState } from 'react';

import { Button } from './components.tsx';

const STORAGE_KEY = 'crossscreen.seen-safety-notice';

/**
 * Shown before someone's first share, on the desktop app the same as the
 * browser. See apps/web's SafetyNotice for the full reasoning (ui-scope.md
 * §3.2, architecture §7): a tool that lets a stranger watch a desktop has to
 * say so before it happens, and only once — a warning people learn to click
 * through trains the reflex it exists to interrupt.
 */
export function useSafetyNotice(): { needed: boolean; acknowledge: () => void } {
  const [needed, setNeeded] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === null;
    } catch {
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
      <p className="bg-status-warn/10 rounded-lg px-4 py-3 text-sm text-[var(--text-strong)]">
        <strong className="block">Only share with people you know.</strong>
        Whoever you allow will see everything on the screen you share — messages, email, anything
        you open. CrossScreen will never ask you to share your screen with support staff.
      </p>
      <Button onClick={onAcknowledge}>I understand</Button>
    </div>
  );
}
