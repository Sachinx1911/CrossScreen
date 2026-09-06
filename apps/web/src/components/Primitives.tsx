import type { ButtonHTMLAttributes, ReactNode } from 'react';

import type { ConnectionState } from '@crossscreen/protocol';

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
