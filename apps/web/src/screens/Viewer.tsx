import { useEffect, useRef, useState } from 'react';

import type { ConnectionQuality, ConnectionState } from '@crossscreen/protocol';
import { ApiClient, qualityFrom, ViewerSession, type ViewerPhase } from '@crossscreen/webrtc-core';

import { useFullscreen } from '../components/Fullscreen.tsx';
import {
  Button,
  Card,
  Notice,
  QualityBadge,
  ReportButton,
  StatusDot,
} from '../components/Primitives.tsx';
import { apiBaseUrl, forceRelay, signalingUrl } from '../config.ts';
import { navigate } from '../router.ts';
import { tagParticipant } from '../sentry.ts';

/**
 * Watching a screen.
 *
 * The waiting state is the one that needed thought. Between asking and being
 * allowed, a person somewhere else is deciding, and nothing observable is
 * happening here — a bare spinner reads as a hang. So the wait says who is
 * being waited on.
 */
export function Viewer({ joinCode, joinToken }: { joinCode?: string; joinToken?: string }) {
  const [phase, setPhase] = useState<ViewerPhase>('connecting');
  const [message, setMessage] = useState<string | undefined>();
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [stats, setStats] = useState<string | undefined>();
  const [quality, setQuality] = useState<ConnectionQuality | undefined>();
  const [reported, setReported] = useState(false);

  const video = useRef<HTMLVideoElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const session = useRef<ViewerSession | undefined>(undefined);
  const fullscreen = useFullscreen(stage, video);

  /**
   * Held in state rather than attached the moment it arrives.
   *
   * The track arrives before the phase becomes `watching`, and the video
   * element only exists once it has — so attaching on the event found a null
   * ref and silently did nothing. The connection reported itself healthy, the
   * stats showed a resolution and a codec, and the picture stayed black.
   */
  const [stream, setStream] = useState<MediaStream | undefined>();

  useEffect(() => {
    const viewer = new ViewerSession({
      api: new ApiClient(apiBaseUrl()),
      signalingUrl: signalingUrl(),
      ...(joinToken === undefined ? {} : { joinToken }),
      ...(joinCode === undefined ? {} : { joinCode }),
      forceRelay: forceRelay(),
    });
    session.current = viewer;

    viewer.on('phase', (event) => {
      setPhase(event.phase);
      setMessage(event.message);
    });
    viewer.on('participant', ({ participantId }) => {
      tagParticipant(participantId);
    });
    viewer.on('reported', () => {
      setReported(true);
    });
    viewer.on('stream', setStream);
    viewer.on('connection', ({ state }) => {
      setConnection(state);
    });
    viewer.on('stats', (snapshot) => {
      setStats(
        [
          snapshot.resolution,
          snapshot.codec,
          snapshot.transport === 'relay' ? 'relayed' : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(' · '),
      );
      setQuality(qualityFrom(snapshot));
    });

    void viewer.start();
    return () => {
      viewer.stop();
    };
  }, [joinCode, joinToken]);

  // Runs after the element exists, which is the whole point.
  useEffect(() => {
    if (video.current !== null && stream !== undefined) {
      video.current.srcObject = stream;
    }
  }, [stream, phase]);

  if (phase === 'watching') {
    return (
      <div
        ref={stage}
        className={
          fullscreen.isFullscreen ? 'flex h-screen w-screen flex-col bg-black' : 'space-y-3'
        }
      >
        <div
          className={`flex items-center justify-between gap-4 ${
            // In fullscreen the bar sits over the picture rather than above
            // it, so the video keeps the whole display.
            fullscreen.isFullscreen
              ? 'absolute inset-x-0 top-0 z-10 bg-black/60 p-3 text-white'
              : ''
          }`}
        >
          <div className="flex items-center gap-4">
            <StatusDot state={connection} />
            {/* Only once actually connected — quality means nothing while
                still negotiating, and StatusDot already covers that wait. */}
            {connection === 'connected' && quality !== undefined && (
              <QualityBadge quality={quality} />
            )}
          </div>
          <div className="flex items-center gap-3">
            {stats !== undefined && <span className="text-xs opacity-70">{stats}</span>}
            {fullscreen.supported && (
              <Button variant="secondary" onClick={fullscreen.toggle}>
                {fullscreen.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              </Button>
            )}
          </div>
        </div>

        {/*
          One `<video>` node, always — its wrapper's className changes with
          `isFullscreen`, but the element itself never unmounts. It used to
          be an if/else between two separate <video> elements, which meant
          entering or leaving fullscreen tore the old one out of the DOM and
          mounted a fresh one with no `srcObject`: the picture vanished the
          instant fullscreen was toggled, which is exactly the bug this
          replaced (most visible on iOS, where `webkitEnterFullscreen()`
          swaps the video into the OS player out from under a node that was
          about to be unmounted anyway).

          Not fullscreen: a fixed 16:9 stage, letterboxed with
          `object-contain` so nothing is cropped, never edge-to-edge.
        */}
        <div
          className={
            fullscreen.isFullscreen
              ? 'h-full w-full bg-black'
              : 'aspect-video max-h-[75vh] w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-black'
          }
        >
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            onDoubleClick={fullscreen.toggle}
            className="h-full w-full object-contain"
          />
        </div>

        {!fullscreen.isFullscreen && (
          <div className="flex items-center justify-between">
            <ReportButton onReport={() => session.current?.report()} reported={reported} />
            <Button
              variant="secondary"
              onClick={() => {
                session.current?.stop();
                navigate('/');
              }}
            >
              Leave
            </Button>
          </div>
        )}
      </div>
    );
  }

  const waiting: Partial<Record<ViewerPhase, string>> = {
    connecting: 'Connecting…',
    'waiting-for-host': 'Waiting for the host to let you in…',
    approved: 'You are in. Waiting for their screen…',
  };

  return (
    <Card className="mx-auto max-w-md space-y-4 text-center">
      {waiting[phase] !== undefined ? (
        <>
          <p className="text-lg">{waiting[phase]}</p>
          {phase === 'waiting-for-host' && (
            <p className="text-sm text-[var(--text-muted)]">
              They have been asked. Nothing is shared until they say yes.
            </p>
          )}
        </>
      ) : (
        <>
          <Notice tone={phase === 'rejected' || phase === 'failed' ? 'error' : 'info'}>
            {message ?? 'The session has ended.'}
          </Notice>
          <Button
            variant="secondary"
            onClick={() => {
              navigate('/');
            }}
          >
            Back to start
          </Button>
        </>
      )}
    </Card>
  );
}
