import { useCallback, useEffect, useRef, useState } from 'react';

import { BrowserCapture, CaptureCancelled, CaptureRefused } from '@crossscreen/capture';
import type { ConnectionState, JoinRequestInfo } from '@crossscreen/protocol';
import { ApiClient, SharerSession, type CreatedSession } from '@crossscreen/webrtc-core';

import { ApprovalPrompt } from '../components/ApprovalPrompt.tsx';
import { CopyField } from '../components/CopyField.tsx';
import { Button, Card, Notice, StatusDot } from '../components/Primitives.tsx';
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
    active.on('viewerLeft', () => {
      setViewers((n) => Math.max(0, n - 1));
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
    } catch {
      setMessage('CrossScreen is unreachable. Check your connection and try again.');
      capture.current.stop();
      setPhase('idle');
    }
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
          <Card className="border-brand-500/40">
            <div className="flex items-center justify-between gap-4">
              <StatusDot state={viewers > 0 ? connection : 'connecting'} />
              <span className="text-sm text-[var(--text-muted)]">
                {viewers === 0
                  ? 'Nobody is watching yet'
                  : `${viewers} ${viewers === 1 ? 'person is' : 'people are'} watching`}
              </span>
            </div>
          </Card>

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

          <video
            ref={preview}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-black"
          />

          <Button variant="danger" onClick={stop}>
            Stop sharing
          </Button>
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
