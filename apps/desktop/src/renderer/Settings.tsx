import { useState } from 'react';

import { clearRecentSessions, readRecentSessions } from '@crossscreen/webrtc-core';

import { forgetSafetyNoticeSeen } from './SafetyNotice.tsx';
import { Button, Card } from './components.tsx';

/**
 * Genuinely minimal, per ui-scope.md §2 — see apps/web's Settings for the
 * full reasoning. The same two controls, over the same two localStorage
 * keys, so what "Settings" means cannot drift between the two shells.
 */
export function Settings({ onBack }: { onBack: () => void }) {
  const [historyCount, setHistoryCount] = useState(() => readRecentSessions().length);
  const [safetyReset, setSafetyReset] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card className="space-y-3">
        <h2 className="font-semibold">Safety notice</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Shown once, the first time you share, so it does not become something people learn to
          click past.
        </p>
        {safetyReset ? (
          <p className="text-sm">You will see it again next time you share.</p>
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
          <p className="text-sm">Cleared.</p>
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

      <button type="button" onClick={onBack} className="text-sm text-[var(--text-muted)] underline">
        Back
      </button>
    </div>
  );
}
