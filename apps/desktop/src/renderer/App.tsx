import { useCallback, useEffect, useRef, useState } from 'react';

import { CaptureCancelled, ElectronCapture, type CaptureSource } from '@crossscreen/capture';
import type { ConnectionState, JoinRequestInfo } from '@crossscreen/protocol';
import { ApiClient, SharerSession, type CreatedSession } from '@crossscreen/webrtc-core';

import { SourcePicker } from './SourcePicker.tsx';
import { ApprovalPrompt, Button, Card, StatusDot } from './components.tsx';
import { apiBaseUrl, signalingUrl } from './config.ts';

type Phase = 'choosing' | 'starting' | 'sharing' | 'stopped';

/**
 * The desktop sharer, on the same `SharerSession` the browser uses.
 *
 * Until now this app spoke the walking skeleton's protocol and was broken
 * against the real signaling service. It now shares the session logic rather
 * than keeping its own copy — which is why that object exists, and why the
 * approval ordering cannot drift between the two shells.
 */
export function App() {
  const [phase, setPhase] = useState<Phase>('choosing');
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [session, setSession] = useState<CreatedSession | undefined>();
  const [pending, setPending] = useState<JoinRequestInfo[]>([]);
  const [viewers, setViewers] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [message, setMessage] = useState<string | undefined>();

  const capture = useRef(new ElectronCapture());
  const sharer = useRef<SharerSession | undefined>(undefined);

  const stop = useCallback(() => {
    sharer.current?.stop();
    sharer.current = undefined;
    capture.current.stop();
    setPhase('stopped');
    setPending([]);
    setViewers(0);
  }, []);

  useEffect(() => {
    void capture.current
      .listSources()
      .then(setSources)
      .catch(() => {
        setMessage('Could not list what is on screen. Try restarting CrossScreen.');
      });
    return stop;
  }, [stop]);

  async function share(source: CaptureSource): Promise<void> {
    setMessage(undefined);
    setPhase('starting');

    let stream: MediaStream;
    try {
      stream = await capture.current.start({ sourceId: source.id, optimiseForText: true });
    } catch (err) {
      // Cancelling is not a failure; going quietly back to the picker is the
      // whole of the correct response.
      if (err instanceof CaptureCancelled) {
        setPhase('choosing');
        return;
      }
      setMessage(err instanceof Error ? err.message : 'Screen sharing could not start.');
      setPhase('choosing');
      return;
    }

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
      if (err instanceof Error && err.message === 'cancelled') return;
      setMessage('CrossScreen is unreachable. Check your connection and try again.');
      capture.current.stop();
      setPhase('choosing');
    }
  }

  function decide(participantId: string, allow: boolean): void {
    setPending((current) => current.filter((r) => r.participantId !== participantId));
    if (allow) sharer.current?.approve(participantId);
    else sharer.current?.reject(participantId);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <h1 className="text-xl font-semibold">
        {phase === 'sharing' ? 'You are sharing your screen' : 'CrossScreen'}
      </h1>

      {message !== undefined && (
        <Card className="border-status-bad/40">
          <p className="text-sm">{message}</p>
        </Card>
      )}

      {phase === 'choosing' && (
        <>
          <p className="text-sm text-[var(--text-muted)]">
            Choose what to share. Nobody sees anything until you allow them.
          </p>
          {sources.length === 0 ? (
            <Card>Looking for screens and windows…</Card>
          ) : (
            <SourcePicker
              sources={sources}
              onChoose={(source) => {
                void share(source);
              }}
            />
          )}
        </>
      )}

      {phase === 'starting' && <Card>Starting…</Card>}

      {phase === 'sharing' && session !== undefined && (
        <>
          {/* Non-dismissible for the whole session: whether a screen is being
              watched must never be in doubt. */}
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

          <Card className="space-y-4">
            <div>
              <p className="text-xs tracking-wide text-[var(--text-muted)] uppercase">
                Session code
              </p>
              <p className="session-code mt-1 text-3xl">{session.joinCodeDisplay}</p>
            </div>
            <div>
              <p className="text-xs tracking-wide text-[var(--text-muted)] uppercase">Share link</p>
              <code className="mt-1 block truncate rounded bg-[var(--surface-sunken)] px-3 py-2 text-sm">
                {session.shareLink}
              </code>
            </div>
          </Card>

          <Button variant="danger" onClick={stop}>
            Stop sharing
          </Button>
        </>
      )}

      {phase === 'stopped' && (
        <Button
          variant="secondary"
          onClick={() => {
            setPhase('choosing');
            setMessage(undefined);
          }}
        >
          Share something else
        </Button>
      )}
    </div>
  );
}
