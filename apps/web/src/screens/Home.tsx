import { Button, Muted } from '../components/Primitives.tsx';
import { navigate } from '../router.ts';
import { BrowserCapture } from '@crossscreen/capture';

/**
 * The landing screen.
 *
 * Two actions, and the capability check happens here rather than after someone
 * has committed to sharing — a phone that cannot share should be told on
 * arrival, alongside what it *can* do, not two screens later.
 */
export function Home() {
  const capabilities = new BrowserCapture().capabilities();

  return (
    <div className="mx-auto max-w-2xl text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Share your screen
        <br />
        <span className="text-brand-500">with anyone</span>
      </h1>

      <p className="mt-5 text-lg text-[var(--text-muted)]">
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

      <dl className="mt-14 grid gap-6 text-left sm:grid-cols-3">
        {[
          ['No account', 'Start in seconds. Nothing to sign up for.'],
          ['Anyone can watch', 'Any modern browser, on a computer or a phone.'],
          ['You decide', 'Nobody sees your screen until you allow them.'],
        ].map(([title, body]) => (
          <div key={title}>
            <dt className="font-semibold">{title}</dt>
            <dd className="mt-1 text-sm">
              <Muted>{body}</Muted>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
