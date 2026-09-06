import { useCallback, useEffect, useRef, useState } from 'react';

import { CaptureCancelled, ElectronCapture, type CaptureSource } from '@crossscreen/capture';
import type { ConnectionState, JoinRequestInfo } from '@crossscreen/protocol';
import { ApiClient, SharerSession, type CreatedSession } from '@crossscreen/webrtc-core';

import { SourcePicker } from './SourcePicker.tsx';
import { ApprovalPrompt, Button, Card, CopyField, StatusDot } from './components.tsx';
import { apiBaseUrl, signalingUrl } from './config.ts';

type Phase = 'choosing' | 'starting' | 'sharing' | 'switching' | 'stopped';

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

  /**
   * Swap what is being shared without dropping anyone.
   *
   * Picking the wrong window is an ordinary mistake, and the old answer to it —
   * stop, choose again, and have everyone ask permission a second time — is a
   * disproportionate amount of ceremony for it.
   */
  async function switchTo(source: CaptureSource): Promise<void> {
    setMessage(undefined);
    let stream: MediaStream;
    try {
      stream = await capture.current.start({ sourceId: source.id, optimiseForText: true });
    } catch (err) {
      if (err instanceof CaptureCancelled) {
        setPhase('sharing');
        return;
      }
      setMessage(err instanceof Error ? err.message : 'That screen could not be shared.');
      setPhase('sharing');
      return;
    }

    await sharer.current?.replaceStream(stream);
    setPhase('sharing');
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

      {(phase === 'choosing' || phase === 'switching') && (
        <>
          <p className="text-sm text-[var(--text-muted)]">
            {phase === 'switching'
              ? 'Choose what to share instead. Nobody watching will be interrupted.'
              : 'Choose what to share. Nobody sees anything until you allow them.'}
          </p>
          {sources.length === 0 ? (
            <Card>Looking for screens and windows…</Card>
          ) : (
            <SourcePicker
              sources={sources}
              onChoose={(source) => {
                if (phase === 'switching') void switchTo(source);
                else void share(source);
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
              {/* With nobody there, "Connecting…" is a lie — there is nothing
                  to connect to yet, and it reads as something being stuck. */}
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

          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                // Refresh the list: windows open and close while sharing, and
                // an old list offers things that are no longer there.
                void capture.current.listSources().then(setSources);
                setPhase('switching');
              }}
            >
              Share something else
            </Button>
            <Button variant="danger" onClick={stop}>
              Stop sharing
            </Button>
          </div>
        </>
      )}

      {phase === 'switching' && (
        <Button
          variant="secondary"
          onClick={() => {
            setPhase('sharing');
          }}
        >
          Keep sharing what I have
        </Button>
      )}

      {phase === 'stopped' && (
        <Button
          variant="secondary"
          onClick={() => {
            setPhase('choosing');
            setMessage(undefined);
          }}
        >
          Start again
        </Button>
      )}
    </div>
  );
}
