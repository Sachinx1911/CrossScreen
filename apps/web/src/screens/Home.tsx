import { Button, Card, Muted } from '../components/Primitives.tsx';
import { navigate } from '../router.ts';
import { BrowserCapture } from '@crossscreen/capture';
import { readRecentSessions } from '@crossscreen/webrtc-core';

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const ANDROID_RELEASES = 'https://github.com/Sachinx1911/CrossScreen/releases/latest';

/**
 * The landing screen.
 *
 * The two actions and the capability check come first — a phone that cannot
 * share should be told on arrival, alongside what it *can* do. Everything
 * below that is the marketing page: how it works, what runs where, and where
 * to get the app, kept to one scroll and no new routes.
 */
export function Home() {
  const capabilities = new BrowserCapture().capabilities();
  // Read once, not kept in state: this list only ever changes from the Share
  // screen, a full navigation away and back.
  const recent = readRecentSessions();

  return (
    <div className="mx-auto max-w-3xl">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Share your screen
          <br />
          <span className="text-brand-500">with anyone</span>
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-lg text-[var(--text-muted)]">
          Send a link. They watch in their browser. Nothing to install, no account to make.
        </p>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            onClick={() => {
              navigate('/share');
            }}
            disabled={!capabilities.canShare}
          >
            Start sharing
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              navigate('/join');
            }}
          >
            Join a session
          </Button>
        </div>

        {!capabilities.canShare && capabilities.reason !== undefined && (
          <p className="mt-4 text-sm text-[var(--text-muted)]">{capabilities.reason}</p>
        )}
      </section>

      <section className="mt-20">
        <h2 className="text-center text-2xl font-semibold">How it works</h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            [
              '1',
              'Start sharing',
              'Pick a screen or a window. Your browser asks — we never see it until you say yes.',
            ],
            [
              '2',
              'Send the code',
              'You get a six-digit code and a link. Send whichever is easier.',
            ],
            [
              '3',
              'They watch',
              'They open the link in any browser and wait for you to let them in.',
            ],
          ].map(([n, title, body]) => (
            <li key={n} className="card p-6">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-100">
                {n}
              </span>
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm">
                <Muted>{body}</Muted>
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20">
        <h2 className="text-center text-2xl font-semibold">Where it works</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <Card>
            <h3 className="font-semibold">Share from</h3>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li>Windows, macOS and Linux — any desktop browser, no install</li>
              <li>Android — the app (below)</li>
              <li>
                <Muted>
                  iPhone and iPad can’t share a screen — that’s an Apple limitation, not ours
                </Muted>
              </li>
            </ul>
          </Card>
          <Card>
            <h3 className="font-semibold">Watch on</h3>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li>Anything with a modern browser</li>
              <li>Phone or computer, iPhone included</li>
              <li>
                <Muted>Nothing to install to watch, ever</Muted>
              </li>
            </ul>
          </Card>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-center text-2xl font-semibold">Get the app</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-[var(--text-muted)]">
          You only need an app to <em>share</em> from a phone. To watch, just open a link.
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <Card>
            <h3 className="font-semibold">Android</h3>
            <p className="mt-1 text-sm">
              <Muted>
                Share your Android screen to anyone. Currently a test build — not on Google Play
                yet.
              </Muted>
            </p>
            <a
              href={ANDROID_RELEASES}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block"
            >
              <Button>Download for Android</Button>
            </a>
          </Card>
          <Card>
            <h3 className="font-semibold">iPhone &amp; iPad</h3>
            <p className="mt-1 text-sm">
              <Muted>
                A sharing app for iOS is in the works. Until then, open a link in Safari to watch —
                that already works.
              </Muted>
            </p>
            <span className="mt-4 inline-block">
              <Button variant="secondary" disabled>
                App Store — coming soon
              </Button>
            </span>
          </Card>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-center text-2xl font-semibold">Questions</h2>
        <div className="mx-auto mt-8 max-w-2xl divide-y divide-[var(--border-subtle)]">
          {[
            [
              'Do I need an account?',
              'No. There’s nothing to sign up for, on the web or in the app.',
            ],
            [
              'Is it private?',
              'The video goes straight between the two devices, encrypted (DTLS-SRTP). When a direct route isn’t possible it’s relayed, still encrypted end to end — the relay can’t read it.',
            ],
            [
              'Can someone watch without me letting them?',
              'No. The code only puts someone in a waiting state; you approve each person before anything is sent to them.',
            ],
            [
              'How long does a session last?',
              'It expires on its own — a few minutes if nobody joins, and there’s a hard cap of a few hours.',
            ],
            [
              'Can an iPhone share its screen?',
              'Not to a website — Apple doesn’t allow it. An iOS app that can is planned. iPhones can watch any session now.',
            ],
          ].map(([q, a]) => (
            <details key={q} className="group py-3">
              <summary className="cursor-pointer list-none font-medium marker:content-none">
                <span className="inline-flex w-full items-center justify-between gap-3">
                  {q}
                  <span className="text-[var(--text-muted)] transition group-open:rotate-45">
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-2 text-sm">
                <Muted>{a}</Muted>
              </p>
            </details>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="mt-20">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--text-muted)] uppercase">
            Recent sessions
          </h2>
          {/* Not clickable: every one of these has long since expired
              (SESSION_TIMEOUTS caps a session at hours, this list at neither) —
              a record kept on this device, not a way back in. */}
          <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
            {recent.map((session) => (
              <li
                key={session.startedAt}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="session-code">{session.joinCodeDisplay}</span>
                <Muted>{dateFormat.format(session.startedAt)}</Muted>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
