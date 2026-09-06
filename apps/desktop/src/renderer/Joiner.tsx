import { useEffect, useRef, useState } from 'react';

import {
  extractJoinToken,
  isValidJoinCode,
  normaliseJoinCode,
  type ConnectionState,
} from '@crossscreen/protocol';
import { ApiClient, ViewerSession, type ViewerPhase } from '@crossscreen/webrtc-core';

import { Button, Card, StatusDot } from './components.tsx';
import { apiBaseUrl, signalingUrl } from './config.ts';

type Stage = 'entering-code' | ViewerPhase;

/**
 * Watching someone else's screen, from the desktop app.
 *
 * The mirror of `apps/web`'s Join + Viewer, on the same `ViewerSession` —
 * listed for Phase 1 in ui-scope.md §2 ("Desktop: Join") and, until now,
 * simply absent: the desktop app could share but not watch. A Windows,
 * macOS or Linux user with nothing but this app installed had no way to
 * accept a link at all.
 */
export function Joiner({ onBack }: { onBack: () => void }) {
  const [stage, setStage] = useState<Stage>('entering-code');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [stream, setStream] = useState<MediaStream | undefined>();

  const video = useRef<HTMLVideoElement | null>(null);
  const session = useRef<ViewerSession | undefined>(undefined);

  // Stopping on unmount, not only on the explicit Leave button — the switch
  // back to Share is a plain state change in the parent, not a navigation,
  // so nothing else would ever close this socket.
  useEffect(() => () => session.current?.stop(), []);

  useEffect(() => {
    if (video.current !== null && stream !== undefined) {
      video.current.srcObject = stream;
    }
  }, [stream, stage]);

  function submit(event: { preventDefault: () => void }): void {
    event.preventDefault();
    setProblem(undefined);

    const pasted = extractJoinToken(code);
    const joinCode = pasted === null ? normaliseJoinCode(code) : undefined;

    if (pasted === null && !isValidJoinCode(joinCode ?? '')) {
      setProblem('A session code is six digits. Check it and try again.');
      return;
    }

    const viewer = new ViewerSession({
      api: new ApiClient(apiBaseUrl()),
      signalingUrl: signalingUrl(),
      ...(pasted === null ? { joinCode: joinCode ?? '' } : { joinToken: pasted }),
    });
    session.current = viewer;

    viewer.on('phase', (event) => {
      setStage(event.phase);
      setMessage(event.message);
    });
    viewer.on('stream', setStream);
    viewer.on('connection', ({ state }) => {
      setConnection(state);
    });

    void viewer.start();
  }

  function leave(): void {
    session.current?.stop();
    session.current = undefined;
    setStream(undefined);
    setMessage(undefined);
    setCode('');
    setStage('entering-code');
  }

  if (stage === 'watching') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <StatusDot state={connection} />
          <Button variant="secondary" onClick={leave}>
            Leave
          </Button>
        </div>
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          className="max-h-[75vh] w-full rounded-lg bg-black object-contain"
        />
      </div>
    );
  }

  if (stage === 'entering-code') {
    return (
      <form onSubmit={submit} className="mx-auto max-w-md space-y-5">
        <Card className="space-y-5">
          <h1 className="text-xl font-semibold">Join a session</h1>
          <div>
            <label htmlFor="join-code" className="mb-1.5 block text-sm font-medium">
              Session code, or paste a link
            </label>
            <input
              id="join-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              placeholder="482 719"
              aria-describedby={problem === undefined ? undefined : 'join-code-problem'}
              className="session-code w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3 text-2xl"
            />
          </div>
          {problem !== undefined && (
            <p id="join-code-problem" className="text-status-bad text-sm" role="alert">
              {problem}
            </p>
          )}
          <Button type="submit" className="w-full">
            Join session
          </Button>
          <p className="text-center text-xs text-[var(--text-muted)]">
            The host will be asked to let you in.
          </p>
        </Card>
        <p className="text-center">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-[var(--text-muted)] underline"
          >
            Back
          </button>
        </p>
      </form>
    );
  }

  const waiting: Partial<Record<ViewerPhase, string>> = {
    connecting: 'Connecting…',
    'waiting-for-host': 'Waiting for the host to let you in…',
    approved: 'You are in. Waiting for their screen…',
  };
  const waitingText = waiting[stage as ViewerPhase];

  return (
    <Card className="mx-auto max-w-md space-y-4 text-center">
      {waitingText !== undefined ? (
        <>
          <p className="text-lg">{waitingText}</p>
          {stage === 'waiting-for-host' && (
            <p className="text-sm text-[var(--text-muted)]">
              They have been asked. Nothing is shared until they say yes.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm">{message ?? 'The session has ended.'}</p>
          <Button variant="secondary" onClick={leave}>
            Back to start
          </Button>
        </>
      )}
    </Card>
  );
}
