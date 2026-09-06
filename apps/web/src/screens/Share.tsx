import { useCallback, useEffect, useRef, useState } from 'react';

import { BrowserCapture, CaptureCancelled, CaptureRefused } from '@crossscreen/capture';
import type { ConnectionState, JoinRequestInfo } from '@crossscreen/protocol';
import {
  ApiClient,
  SharerSession,
  type CreatedSession,
  type QualityMode,
} from '@crossscreen/webrtc-core';

import { ApprovalPrompt } from '../components/ApprovalPrompt.tsx';
import { CopyField } from '../components/CopyField.tsx';
import { Button, Card, Notice, StatusDot } from '../components/Primitives.tsx';
import { QualityToggle } from '../components/QualityToggle.tsx';
import { SafetyNotice, useSafetyNotice } from '../components/SafetyNotice.tsx';
import { apiBaseUrl, signalingUrl } from '../config.ts';
import { navigate } from '../router.ts';

type Phase = 'idle' | 'starting' | 'sharing' | 'stopped';

/**
 * Sharing a screen from a browser tab — the primary path for v1 (ADR-0010).
 *
 * The order is the point: capture first, session second. Asking the browser
 * for a screen is the step a person can decline, and creating a session before
 * they have decided leaves a code nobody will use.
 */
export function Share() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<CreatedSession | undefined>();
  const [pending, setPending] = useState<JoinRequestInfo[]>([]);
  const [viewers, setViewers] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [message, setMessage] = useState<string | undefined>();
  const [quality, setQuality] = useState<QualityMode>('text');

  const sharer = useRef<SharerSession | undefined>(undefined);
  const capture = useRef(new BrowserCapture());
  const preview = useRef<HTMLVideoElement | null>(null);
  const safety = useSafetyNotice();

  const stop = useCallback(() => {
    sharer.current?.stop();
    sharer.current = undefined;
    capture.current.stop();
    setPhase('stopped');
    setPending([]);
    setViewers(0);
  }, []);

  // Stop on unmount, so navigating away never leaves a screen being shared to
  // a page nobody is looking at.
  useEffect(() => stop, [stop]);

  async function start(): Promise<void> {
    setMessage(undefined);
    setPhase('starting');

    let stream: MediaStream;
    try {
      stream = await capture.current.start({ optimiseForText: true });
    } catch (err) {
      // Cancelling is not a failure. Saying nothing and going back is the
      // whole of the correct response.
      if (err instanceof CaptureCancelled) {
        setPhase('idle');
        return;
      }
      setMessage(err instanceof CaptureRefused ? err.message : 'Screen sharing could not start.');
      setPhase('idle');
      return;
    }

    if (preview.current !== null) preview.current.srcObject = stream;

    const active = new SharerSession({
      api: new ApiClient(apiBaseUrl()),
      signalingUrl: signalingUrl(),
      stream,
    });
    sharer.current = active;

    active.on('pending', (request) => {
      setPending((current) => [...current, request]);
    });
    active.on('viewerJoined', () => {
      setViewers((n) => n + 1);
    });
    active.on('viewerLeft', ({ participantId }) => {
      setViewers((n) => Math.max(0, n - 1));
      // Someone who leaves while still waiting takes their prompt with them.
      setPending((current) => current.filter((r) => r.participantId !== participantId));
    });
    active.on('connection', ({ state }) => {
      setConnection(state);
    });
    active.on('error', ({ message: text }) => {
      setMessage(text);
    });
    active.on('ended', ({ reason }) => {
      setMessage(reason);
      stop();
    });

    try {
      setSession(await active.start());
      setPhase('sharing');
    } catch (err) {
      // A cancellation is our own doing — the component went away mid-start —
      // and telling the user their connection failed would be a lie.
      if (err instanceof Error && err.message === 'cancelled') return;
      // The capture is stopped here, and saying so matters: the person granted
      // a screen a moment ago and everything then vanished. Without this they
      // have no way to know whether it is still being shared.
      capture.current.stop();
      setMessage(
        'CrossScreen is unreachable, so the screen share was stopped. Nothing was shared. Try again once you are connected.',
      );
      setPhase('idle');
    }
  }

  /**
   * Swap what is being shared without dropping anyone.
   *
   * Picking the wrong window is an ordinary mistake, and the old answer to it —
   * stop, choose again, and have everyone ask permission a second time — is a
   * disproportionate amount of ceremony for it. `replaceTrack` changes the
   * outgoing media on a live connection, so viewers see the new screen appear
   * in place of the old one.
   */
  async function switchScreen(): Promise<void> {
    setMessage(undefined);

    let stream: MediaStream;
    try {
      stream = await capture.current.start({ optimiseForText: true });
    } catch (err) {
      // Changing their mind at the picker leaves the current share running,
      // which is exactly right — nothing was broken.
      if (err instanceof CaptureCancelled) return;
      setMessage(err instanceof CaptureRefused ? err.message : 'That screen could not be shared.');
      return;
    }

    if (preview.current !== null) preview.current.srcObject = stream;
    await sharer.current?.replaceStream(stream);
  }

  function decide(participantId: string, allow: boolean): void {
    setPending((current) => current.filter((r) => r.participantId !== participantId));
    if (allow) sharer.current?.approve(participantId);
    else sharer.current?.reject(participantId);
  }

  if (safety.needed) {
    return (
      <Card className="mx-auto max-w-xl">
        <h1 className="mb-4 text-xl font-semibold">Before you share</h1>
        <SafetyNotice onAcknowledge={safety.acknowledge} />
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold">
        {phase === 'sharing' ? 'You are sharing your screen' : 'Share your screen'}
      </h1>

      {message !== undefined && <Notice tone="error">{message}</Notice>}

      {(phase === 'idle' || phase === 'stopped') && (
        <Card>
          <p className="text-sm text-[var(--text-muted)]">
            Your browser will ask which screen or window to share. You will get a code and a link to
            send, and nobody sees anything until you allow them.
          </p>
          <div className="mt-5">
            <Button onClick={() => void start()}>Choose a screen</Button>
          </div>
        </Card>
      )}

      {phase === 'starting' && <Card>Waiting for you to pick a screen…</Card>}

      {phase === 'sharing' && session !== undefined && (
        <>
          {/* Non-dismissible for the whole session: the one thing that must
              never be in doubt is whether a screen is being watched. */}
          {/*
            The indicator and the way to stop, together, above everything else
            and stuck to the top of the screen.

            They were separated before, with the preview between them, which
            pushed Stop sharing below the fold — reported, correctly, as the
            button not being there. A screen being shared with no visible way
            to stop it is the worst control in this product to lose.
          */}
          <div className="sticky top-0 z-20 -mx-1 bg-[var(--surface-page)] px-1 py-2">
            <Card className="border-brand-500/40">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {viewers === 0 ? (
                    <span className="inline-flex items-center gap-2 text-sm">
                      <span
                        className="bg-status-good h-2.5 w-2.5 shrink-0 rounded-full"
                        aria-hidden="true"
                      />
                      <span>Ready to share</span>
                    </span>
                  ) : (
                    <StatusDot state={connection} />
                  )}
                  <span className="text-sm text-[var(--text-muted)]">
                    {viewers === 0
                      ? 'Send the code or link to someone'
                      : `${viewers} ${viewers === 1 ? 'person is' : 'people are'} watching`}
                  </span>
                </div>

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => void switchScreen()}>
                    Share something else
                  </Button>
                  <Button variant="danger" onClick={stop}>
                    Stop sharing
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {pending.map((request) => (
            <ApprovalPrompt
              key={request.participantId}
              request={request}
              onApprove={() => {
                decide(request.participantId, true);
              }}
              onReject={() => {
                decide(request.participantId, false);
              }}
            />
          ))}

          <Card className="space-y-5">
            <CopyField
              label="Session code"
              value={session.joinCode}
              display={session.joinCodeDisplay}
              large
            />
            <CopyField label="Share link" value={session.shareLink} />
            <p className="text-xs text-[var(--text-muted)]">
              Anyone with this code or link can ask to watch. You still decide.
            </p>
          </Card>

          {/* Changing this takes effect immediately, with no interruption to
              anyone watching — encoder parameters can be set on a live sender. */}
          <Card>
            <QualityToggle
              mode={quality}
              onChange={(mode) => {
                setQuality(mode);
                void sharer.current?.setQuality(mode);
              }}
            />
          </Card>

          <div>
            <p className="mb-1.5 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
              What they see
            </p>
            {/* Capped: this is confirmation that the right thing is being
                shared, not the main event. */}
            <video
              ref={preview}
              autoPlay
              playsInline
              muted
              className="max-h-48 w-full rounded-lg border border-[var(--border-subtle)] bg-black object-contain"
            />
          </div>

          {/* Sharing a whole screen means this tab is behind whatever is being
              shared, so this button is not the one they will reach for. Saying
              the browser's own bar works avoids the reasonable conclusion that
              there is no way to stop without finding this page again. */}
          <p className="text-xs text-[var(--text-muted)]">
            Your browser also shows its own “Stop sharing” bar. Either one ends the session.
          </p>
        </>
      )}

      {phase === 'stopped' && (
        <Button
          variant="secondary"
          onClick={() => {
            navigate('/');
          }}
        >
          Back to start
        </Button>
      )}
    </div>
  );
}
