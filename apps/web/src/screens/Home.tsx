import {
  AndroidIcon,
  AppleIcon,
  BoltIcon,
  CheckIcon,
  DownloadIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  MonitorIcon,
  PeopleIcon,
  PlayIcon,
  WindowsIcon,
} from '../components/Icons.tsx';
import { Button, Muted } from '../components/Primitives.tsx';
import { navigate } from '../router.ts';
import { BrowserCapture } from '@crossscreen/capture';
import { readRecentSessions } from '@crossscreen/webrtc-core';
import type { ComponentType, ReactNode, SVGProps } from 'react';

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const ANDROID_RELEASES = 'https://github.com/Sachinx1911/CrossScreen/releases/latest';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * The landing page.
 *
 * The Start sharing / Join buttons and the capability check come first — a
 * device that cannot share should be told on arrival. Everything below is
 * the marketing page, laid out to the supplied reference: hero, how it
 * works, where it works, get the app, and a closing call to action. One
 * scroll, no new routes, existing components and theme.
 */
export function Home() {
  const capabilities = new BrowserCapture().capabilities();
  const recent = readRecentSessions();

  return (
    <>
      <Hero canShare={capabilities.canShare} reason={capabilities.reason} />
      <HowItWorks />
      <WhereItWorks />
      <GetTheApp />
      <Faqs />
      <ClosingCta />

      {recent.length > 0 && (
        <Section>
          <h2 className="text-sm font-semibold tracking-wide text-[var(--text-muted)] uppercase">
            Recent sessions
          </h2>
          {/* Not clickable: every one has long since expired — a record kept
              on this device, not a way back in. */}
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
        </Section>
      )}
    </>
  );
}

function Section({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <section
      id={id}
      className="mx-auto max-w-[1180px] scroll-mt-24 px-5 py-16 sm:px-7 sm:py-[92px]"
    >
      {children}
    </section>
  );
}

function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="text-center">
      <h2 className="text-[34px] font-bold tracking-[-0.03em] sm:text-[42px]">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-[var(--text-muted)]">{sub}</p>
    </div>
  );
}

function Scribble({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block -rotate-3 text-sm font-medium text-brand-500 italic">
      {children}
    </span>
  );
}

function Hero({ canShare, reason }: { canShare: boolean; reason: string | undefined }) {
  return (
    <section
      id="top"
      className="scroll-mt-24 bg-[radial-gradient(circle_at_85%_30%,var(--color-brand-50),transparent_45%)] dark:bg-[radial-gradient(circle_at_85%_30%,rgb(47_111_237/0.08),transparent_45%)]"
    >
      <div className="mx-auto grid max-w-[1180px] items-center gap-14 px-5 py-16 sm:px-7 sm:py-24 lg:grid-cols-2">
        <div>
          <p className="text-xs font-bold tracking-[0.2em] text-brand-500 uppercase">
            Any Screen. Any Device. Together.
          </p>
          <h1 className="mt-4 text-[clamp(44px,6vw,72px)] leading-[0.98] font-extrabold tracking-[-0.04em]">
            Share your screen
            <br />
            <span className="text-brand-500">with anyone</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-[var(--text-muted)]">
            Send a link. They watch in their browser. Nothing to install, no account to make.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={() => {
                navigate('/share');
              }}
              disabled={!canShare}
            >
              <PlayIcon width={16} height={16} />
              Start sharing
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                navigate('/join');
              }}
            >
              <PeopleIcon width={16} height={16} />
              Join a session
            </Button>
          </div>

          {!canShare && reason !== undefined && (
            <p className="mt-4 text-sm text-[var(--text-muted)]">{reason}</p>
          )}

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--text-muted)]">
            <Trust icon={BoltIcon} label="Fast & Simple" />
            <Trust icon={LockIcon} label="Secure & Encrypted" />
            <Trust icon={GlobeIcon} label="Works Everywhere" />
          </div>
        </div>

        <HeroArt />
      </div>
    </section>
  );
}

function Trust({ icon: Icon, label }: { icon: Icon; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon width={16} height={16} className="text-brand-500" />
      {label}
    </span>
  );
}

/**
 * The device showcase from home-page-desing/prototype.html: a laptop, a
 * tablet and a phone all showing the same screen. No image asset — the
 * "screen" is a CSS gradient inside a dark bezel — so it adds nothing to
 * load and scales cleanly.
 */
function HeroArt() {
  const wall = 'h-full w-full bg-[linear-gradient(135deg,#0b1b4d,#2563eb_55%,#8bdcff)]';
  const bezel =
    'absolute overflow-hidden rounded-[18px] border-[7px] border-[#0f172a] shadow-[0_25px_60px_rgb(15_23_42/0.18)]';

  return (
    <div className="relative h-[300px] sm:h-[390px]">
      <div className={`${bezel} right-0 top-6 aspect-[420/270] w-[70%] max-w-[420px]`}>
        <div className={wall} />
      </div>
      <div className={`${bezel} bottom-1 left-2 aspect-[225/300] w-[42%] max-w-[225px]`}>
        <div className={wall} />
      </div>
      <div className={`${bezel} bottom-0 left-[40%] aspect-[118/235] w-[24%] max-w-[118px]`}>
        <div className={wall} />
      </div>

      <div className="card absolute top-10 left-0 flex items-center gap-2 px-4 py-3 text-xs font-bold">
        <WindowsIcon width={14} height={14} className="text-brand-500" />
        You share on this device
      </div>
      <div className="card absolute top-[140px] right-0 flex items-center gap-2 px-4 py-3 text-xs font-bold">
        <GlobeIcon width={14} height={14} className="text-brand-500" />
        They watch on any device
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps: [string, string, string, Icon, string][] = [
    [
      '1',
      'Start sharing',
      'Pick a screen or a window. Your browser asks — we never see it until you say yes.',
      MonitorIcon,
      'text-brand-500 bg-brand-50 dark:bg-brand-500/10',
    ],
    [
      '2',
      'Send the code',
      'You get a six-digit code and a link. Send whichever is easier.',
      LinkIcon,
      'text-status-good bg-status-good/10',
    ],
    [
      '3',
      'They watch',
      'They open the link in any browser and wait for you to let them in.',
      PeopleIcon,
      'text-brand-700 bg-brand-100 dark:text-brand-100 dark:bg-brand-500/10',
    ],
  ];

  return (
    <Section id="how-it-works">
      <SectionHeading title="How it works" sub="Share your screen in three simple steps" />
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {steps.map(([n, title, body, Icon, badge], i) => (
          <div key={n} className="relative">
            <div className="card h-full p-6">
              <span
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${badge}`}
              >
                {n}
              </span>
              <Icon width={24} height={24} className="mt-4 text-[var(--text-muted)]" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm">
                <Muted>{body}</Muted>
              </p>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute top-1/2 -right-4 hidden -translate-y-1/2 text-xl text-[var(--border-subtle)] lg:block"
              >
                ›
              </span>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function WhereItWorks() {
  return (
    <Section id="features">
      <SectionHeading
        title="Where it works"
        sub="Share from your device. Watch on any modern browser."
      />
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold">
              <MonitorIcon width={18} height={18} className="text-brand-500" /> Share from
            </h3>
            <Scribble>same experience everywhere</Scribble>
          </div>
          {/* Linux is deliberately left off the messaging for now
              (home-page-desing spec: "added later"). */}
          <ul className="mt-4 space-y-2 text-sm">
            <Row icon={WindowsIcon}>Windows</Row>
            <Row icon={AppleIcon}>macOS</Row>
            <Row icon={AndroidIcon}>Android — the app</Row>
            <Row icon={AppleIcon} muted>
              iPhone &amp; iPad — app in the works; watch in Safari today
            </Row>
          </ul>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold">
              <GlobeIcon width={18} height={18} className="text-brand-500" /> Watch on
            </h3>
            <Scribble>nothing to install</Scribble>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            <Row icon={CheckIcon}>Chrome</Row>
            <Row icon={CheckIcon}>Edge</Row>
            <Row icon={CheckIcon}>Safari — iPhone included</Row>
            <Row icon={CheckIcon}>Firefox</Row>
            <Row icon={CheckIcon} muted>
              Any modern browser, on a phone or a computer
            </Row>
          </ul>
        </div>
      </div>
    </Section>
  );
}

function Row({
  icon: Icon,
  muted,
  children,
}: {
  icon: Icon;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3">
      <Icon
        width={16}
        height={16}
        className={muted ? 'text-[var(--text-muted)]' : 'text-brand-500'}
      />
      {muted ? <Muted>{children}</Muted> : children}
    </li>
  );
}

function GetTheApp() {
  return (
    <Section id="get-app">
      <SectionHeading
        title="Get the app"
        sub="You only need an app to share from a phone. To watch, just open a link."
      />
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="card flex flex-col gap-3 p-6">
          <h3 className="flex items-center gap-2 font-semibold">
            <AndroidIcon width={22} height={22} className="text-status-good" /> Android
          </h3>
          <p className="text-sm">
            <Muted>
              Share your Android screen with anyone. A test build for now — not on Google Play yet.
            </Muted>
          </p>
          <a href={ANDROID_RELEASES} target="_blank" rel="noreferrer" className="mt-1 self-start">
            <Button>
              <DownloadIcon width={16} height={16} />
              Download for Android
            </Button>
          </a>
        </div>

        <div className="card flex flex-col gap-3 p-6">
          <h3 className="flex items-center gap-2 font-semibold">
            <AppleIcon width={22} height={22} /> iPhone &amp; iPad
          </h3>
          <p className="text-sm">
            <Muted>
              A sharing app for iOS is in the works. Until then, open a link in Safari to watch —
              that already works.
            </Muted>
          </p>
          <span className="mt-1 self-start">
            <Button variant="secondary" disabled>
              App Store — coming soon
            </Button>
          </span>
        </div>
      </div>
    </Section>
  );
}

function Faqs() {
  const qa: [string, string][] = [
    ['Do I need an account?', 'No. There is nothing to sign up for, on the web or in the app.'],
    [
      'Is it private?',
      'The video goes straight between the two devices, encrypted (DTLS-SRTP). When a direct route is not possible it is relayed, still encrypted end to end — the relay cannot read it.',
    ],
    [
      'Can someone watch without me letting them?',
      'No. The code only puts someone in a waiting state; you approve each person before anything is sent to them.',
    ],
    [
      'How long does a session last?',
      'It expires on its own — a few minutes if nobody joins, and a hard cap of a few hours.',
    ],
    [
      'Can an iPhone share its screen?',
      'Not to a website — Apple does not allow it. An iOS app that can is planned. iPhones can watch any session today.',
    ],
  ];

  return (
    <Section id="faqs">
      <SectionHeading title="Questions" sub="The ones people ask before their first session" />
      <div className="mx-auto mt-8 max-w-2xl divide-y divide-[var(--border-subtle)]">
        {qa.map(([q, a]) => (
          <details key={q} className="group py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium marker:content-none">
              {q}
              <span className="text-[var(--text-muted)] transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 text-sm">
              <Muted>{a}</Muted>
            </p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function ClosingCta() {
  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-24 sm:px-7">
      <div className="flex flex-col items-start justify-between gap-6 rounded-[22px] bg-[linear-gradient(100deg,#2f6fed,#1f57c9)] px-8 py-10 text-white sm:flex-row sm:items-center sm:px-10">
        <div>
          <h2 className="text-[30px] font-bold">Ready to share?</h2>
          <p className="mt-1 text-brand-100">Help, teach, support — together.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              navigate('/share');
            }}
            className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-white px-5 py-3 text-sm font-bold text-brand-700 transition hover:bg-brand-50"
          >
            <PlayIcon width={16} height={16} />
            Start sharing
          </button>
          <button
            type="button"
            onClick={() => {
              navigate('/join');
            }}
            className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-white/70 px-5 py-3 text-sm font-bold transition hover:bg-white/10"
          >
            <PeopleIcon width={16} height={16} />
            Join a session
          </button>
        </div>
      </div>
    </div>
  );
}
