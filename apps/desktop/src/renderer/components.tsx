import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import type { ConnectionQuality, ConnectionState, JoinRequestInfo } from '@crossscreen/protocol';

/**
 * The desktop app's own copies of the shapes the web app uses.
 *
 * Duplicated on purpose, for now. `packages/ui` becomes worth extracting when
 * the two have diverged enough to show what actually needs sharing — doing it
 * on the first repetition would freeze the wrong abstraction, and these are
 * small.
 */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  children: ReactNode;
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const variants = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600',
    secondary:
      'border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-sunken)]',
    danger: 'bg-status-bad text-white hover:opacity-90',
  } as const;

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function StatusDot({ state }: { state: ConnectionState }) {
  const appearance: Record<ConnectionState, [string, string]> = {
    connecting: ['bg-status-warn', 'Connecting…'],
    checking: ['bg-status-warn', 'Checking connection…'],
    securing: ['bg-status-warn', 'Establishing secure connection…'],
    connected: ['bg-status-good', 'Connected'],
    unstable: ['bg-status-warn', 'Connection unstable'],
    reconnecting: ['bg-status-warn', 'Reconnecting…'],
    failed: ['bg-status-bad', 'Connection failed'],
  };
  const [colour, label] = appearance[state];

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      {/* Never colour alone: this is the one indicator that says whether the
          thing on screen is live. */}
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colour}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/**
 * The mockup's "Good Connection" label, made real (phase-2-reliability.md
 * §2.5) — the mirror of `apps/web`'s `QualityBadge`, derived from round-trip
 * time, packet loss and available bandwidth (`qualityFrom` in
 * `@crossscreen/webrtc-core`) rather than connection state alone.
 */
export function QualityBadge({ quality }: { quality: ConnectionQuality }) {
  const appearance: Record<ConnectionQuality, [string, string]> = {
    excellent: ['bg-status-good', 'Excellent connection'],
    good: ['bg-status-good', 'Good connection'],
    poor: ['bg-status-warn', 'Poor connection'],
    unstable: ['bg-status-bad', 'Unstable connection'],
  };
  const [colour, label] = appearance[quality];

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colour}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/**
 * Something to copy, with confirmation that it worked.
 *
 * A share link that cannot be copied is close to useless — it exists to be
 * pasted into a message. And without the confirmation people press the button
 * repeatedly, because a clipboard write is otherwise completely invisible.
 */
export function CopyField({
  label,
  value,
  display,
  large = false,
}: {
  label: string;
  value: string;
  display?: string;
  large?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard access can be refused, and there is nothing to do about it.
      // The value is on screen and selectable either way.
      setCopied(false);
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-xs tracking-wide text-[var(--text-muted)] uppercase">{label}</p>
      <div className="flex items-center gap-3">
        <code
          className={`flex-1 truncate rounded-lg bg-[var(--surface-sunken)] px-4 py-3 ${
            large ? 'session-code text-3xl' : 'text-sm'
          }`}
        >
          {display ?? value}
        </code>
        <Button variant="secondary" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Sharp text, or smooth motion. See apps/web QualityToggle for the reasoning:
 * these are opposite answers to the same question, not points on a dial.
 */
export function QualityToggle({
  mode,
  onChange,
}: {
  mode: 'text' | 'motion';
  onChange: (mode: 'text' | 'motion') => void;
}) {
  const options = [
    { value: 'text' as const, label: 'Sharp text', hint: 'Best for documents and code' },
    { value: 'motion' as const, label: 'Smooth video', hint: 'Best for anything moving' },
  ];

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        Optimise for
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
              mode === option.value
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                : 'border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)]'
            }`}
          >
            <input
              type="radio"
              name="quality"
              value={option.value}
              checked={mode === option.value}
              onChange={() => {
                onChange(option.value);
              }}
              className="sr-only"
            />
            <span className="block font-medium">{option.label}</span>
            <span className="block text-xs text-[var(--text-muted)]">{option.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** See apps/web AudioToggle — the same reasoning, off by default (ui-scope.md §1 C4). */
export function AudioToggle({
  checked,
  onChange,
  available,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  available: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-sm transition ${
        available
          ? 'cursor-pointer border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)]'
          : 'cursor-not-allowed opacity-50'
      }`}
      title={available ? undefined : 'Not available on this platform yet. Windows desktop can.'}
    >
      <span>
        <span className="block font-medium">Share system audio</span>
        <span className="block text-xs text-[var(--text-muted)]">
          {available ? 'Include sound playing on your computer' : 'Not available here yet'}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={!available}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="accent-brand-500 h-5 w-5 shrink-0"
      />
    </label>
  );
}

/** See apps/web ApprovalPrompt — the same decision, the same reasoning. */
export function ApprovalPrompt({
  request,
  onApprove,
  onReject,
}: {
  request: JoinRequestInfo;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="card border-brand-500/40 p-5" role="alertdialog">
      <p className="font-semibold">Someone wants to view your screen</p>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {request.deviceLabel} ·{' '}
        {request.joinedVia === 'link' ? 'Opened your share link' : 'Typed your session code'}
      </p>
      <p className="mt-3 text-sm">
        They will see everything on the screen you are sharing, until you stop.
      </p>
      <div className="mt-4 flex gap-3">
        {/* Reject first, so a keyboard user does not tab onto the
            irreversible choice. */}
        <Button variant="secondary" onClick={onReject}>
          Reject
        </Button>
        <Button onClick={onApprove}>Allow</Button>
      </div>
    </div>
  );
}

/**
 * "Something is wrong with this session" (phase-3a-production.md §3.2) — the
 * mirror of `apps/web`'s own `ReportButton`. See that file's comment for
 * what this is and is not: `reported` is the server's own confirmation, not
 * an optimistic local flag.
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
