import type { JoinRequestInfo } from '@crossscreen/protocol';

import { Button } from './Primitives.tsx';

/**
 * The approval prompt.
 *
 * Missing from the supplied mockup and added deliberately (docs/ui-scope.md
 * §3.1). Without it the six-digit code is the only thing between a stranger
 * and someone's desktop, and a million codes is not enough on its own —
 * approval is what makes the friendly short code safe (ADR-0006).
 *
 * It shows device and how they arrived so the host can tell whether this is
 * the person they sent the link to. It says plainly what saying yes means,
 * because "Allow" on its own does not convey "this person will see everything
 * on your screen".
 */
export function ApprovalPrompt({
  request,
  onApprove,
  onReject,
}: {
  request: JoinRequestInfo;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div
      className="card border-brand-500/40 p-5"
      role="alertdialog"
      aria-labelledby="approval-title"
    >
      <p id="approval-title" className="font-semibold">
        Someone wants to view your screen
      </p>

      <dl className="mt-3 space-y-1 text-sm text-[var(--text-muted)]">
        <div className="flex gap-2">
          <dt className="sr-only">Device</dt>
          <dd>{request.deviceLabel}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">Joined using</dt>
          <dd>
            {request.joinedVia === 'link' ? 'Opened your share link' : 'Typed your session code'}
          </dd>
        </div>
        {request.approximateLocation !== undefined && (
          <div className="flex gap-2">
            <dt className="sr-only">Location</dt>
            <dd>{request.approximateLocation}</dd>
          </div>
        )}
      </dl>

      <p className="mt-3 text-sm">
        They will see everything on the screen you are sharing, until you stop.
      </p>

      <div className="mt-4 flex gap-3">
        {/* Reject first in the DOM so a keyboard user does not tab straight
            onto the irreversible choice. */}
        <Button variant="secondary" onClick={onReject}>
          Reject
        </Button>
        <Button onClick={onApprove}>Allow</Button>
      </div>
    </div>
  );
}
