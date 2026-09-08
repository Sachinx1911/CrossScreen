import type { ButtonHTMLAttributes, ReactNode } from 'react';

import type { ConnectionQuality, ConnectionState } from '@crossscreen/protocol';

/**
 * The handful of shapes every screen uses.
 *
 * Deliberately small. `packages/ui` becomes worth extracting when the desktop
 * app needs the same components; until there is a second consumer, a package
 * would be a folder with an import path.
 */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  children: ReactNode;
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600',
    secondary:
      'border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-sunken)]',
    danger: 'bg-status-bad text-white hover:opacity-90',
  } as const;

  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-6 ${className}`}>{children}</div>;
}

/**
 * Connection status.
 *
 * The dot is never alone: colour by itself is unreadable to a good number of
 * people, and this is the one indicator that tells someone whether the thing
 * they are looking at is live.
 */
export function StatusDot({ state }: { state: ConnectionState }) {
  const appearance: Record<ConnectionState, { colour: string; label: string }> = {
    connecting: { colour: 'bg-status-warn', label: 'Connecting…' },
    checking: { colour: 'bg-status-warn', label: 'Checking connection…' },
    securing: { colour: 'bg-status-warn', label: 'Establishing secure connection…' },
    connected: { colour: 'bg-status-good', label: 'Connected' },
    unstable: { colour: 'bg-status-warn', label: 'Connection unstable' },
    reconnecting: { colour: 'bg-status-warn', label: 'Reconnecting…' },
    failed: { colour: 'bg-status-bad', label: 'Connection failed' },
  };

  const { colour, label } = appearance[state];

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colour}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/**
 * The mockup's "Good Connection" label, made real (phase-2-reliability.md
 * §2.5) — a finer-grained read than `StatusDot`'s connected/not, derived from
 * round-trip time, packet loss and available bandwidth once there is enough
 * of a connection to have measured any of them (`qualityFrom` in
 * `@crossscreen/webrtc-core`).
 */
export function QualityBadge({ quality }: { quality: ConnectionQuality }) {
  const appearance: Record<ConnectionQuality, { colour: string; label: string }> = {
    excellent: { colour: 'bg-status-good', label: 'Excellent connection' },
    good: { colour: 'bg-status-good', label: 'Good connection' },
    poor: { colour: 'bg-status-warn', label: 'Poor connection' },
    unstable: { colour: 'bg-status-bad', label: 'Unstable connection' },
  };

  const { colour, label } = appearance[quality];

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colour}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/** A message the user is meant to act on, never a stack trace. */
export function Notice({
  tone = 'info',
  id,
  children,
}: {
  tone?: 'info' | 'warning' | 'error';
  id?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100',
    warning: 'bg-status-warn/10 text-[var(--text-strong)]',
    error: 'bg-status-bad/10 text-[var(--text-strong)]',
  } as const;

  return (
    <p
      id={id}
      className={`rounded-lg px-4 py-3 text-sm ${tones[tone]}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {children}
    </p>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}

/**
 * "Something is wrong with this session" (phase-3a-production.md §3.2) — a
 * public screen-sharing service is a standard vector for tech-support scams,
 * and this exists so a person mid-session has somewhere to say so without
 * having to already know where `abuse_log` lives. `reported` is owned by the
 * caller, not this component: it comes from the session object's own
 * `reported` event, the server's actual confirmation the report landed,
 * rather than an optimistic local flag that could show "reported" for
 * something the network never delivered.
 */
export function ReportButton({ onReport, reported }: { onReport: () => void; reported: boolean }) {
  if (reported) {
    return <span className="text-xs text-[var(--text-muted)]">Report received — thank you.</span>;
  }
  return (
    <button
      type="button"
      onClick={onReport}
      className="text-xs text-[var(--text-muted)] underline decoration-dotted hover:text-[var(--text-strong)]"
    >
      Report a problem
    </button>
  );
}
