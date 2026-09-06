import { useState } from 'react';

import { clearRecentSessions, readRecentSessions } from '@crossscreen/webrtc-core';

import { forgetSafetyNoticeSeen } from '../components/SafetyNotice.tsx';
import { Button, Card, Muted, Notice } from '../components/Primitives.tsx';

/**
 * Genuinely minimal, per ui-scope.md §2 — there is nothing to configure yet.
 * No accounts (ADR-0007) means no profile, and the one preference that
 * exists today (sharp text vs. smooth video) is chosen per share, on the
 * Share screen, where it can be judged against what is actually on screen.
 *
 * What belongs here instead is control over the two things this device
 * remembers on its own: the safety notice it will not show twice, and the
 * list of what has been shared. Both live in localStorage; both are
 * reversible from here rather than by clearing browser data wholesale.
 */
export function Settings() {
  const [historyCount, setHistoryCount] = useState(() => readRecentSessions().length);
  const [safetyReset, setSafetyReset] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card className="space-y-3">
        <h2 className="font-semibold">Safety notice</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Shown once, the first time you share, so it does not become something people learn to
          click past.
        </p>
        {safetyReset ? (
          <Notice tone="info">You will see it again next time you share.</Notice>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              forgetSafetyNoticeSeen();
              setSafetyReset(true);
            }}
          >
            Show it again next time
          </Button>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Recent sessions</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {historyCount === 0
            ? 'Nothing recorded on this device yet.'
            : `${historyCount} ${historyCount === 1 ? 'session' : 'sessions'} kept on this device.`}
        </p>
        {historyCleared ? (
          <Notice tone="info">Cleared.</Notice>
        ) : (
          <Button
            variant="secondary"
            disabled={historyCount === 0}
            onClick={() => {
              clearRecentSessions();
              setHistoryCleared(true);
              setHistoryCount(0);
            }}
          >
            Clear history
          </Button>
        )}
      </Card>

      <Muted>
        Kept only on this device, never synced and never tied to an account — clearing your
        browser's data removes the same thing this does.
      </Muted>
    </div>
  );
}
