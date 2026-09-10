import type { ReactNode } from 'react';

import { GearIcon } from './Icons.tsx';
import { navigate } from '../router.ts';

const NAV = [
  ['#top', 'Home'],
  ['#how-it-works', 'How it works'],
  ['#features', 'Features'],
  ['#get-app', 'Get the app'],
  ['#faqs', 'FAQs'],
] as const;

function Logo() {
  return (
    <a
      href="/"
      onClick={(event) => {
        event.preventDefault();
        navigate('/');
      }}
      className="flex items-center gap-2 font-semibold"
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2" y="4" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
          <rect
            x="9"
            y="11"
            width="13"
            height="9"
            rx="2"
            fill="var(--color-brand-500)"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </span>
      CrossScreen
    </a>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--surface-page)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Logo />

          <nav className="hidden items-center gap-7 text-sm md:flex">
            {NAV.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="text-[var(--text-muted)] transition hover:text-[var(--text-strong)]"
              >
                {label}
              </a>
            ))}
          </nav>

          <a
            href="/settings"
            onClick={(event) => {
              event.preventDefault();
              navigate('/settings');
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-1.5 text-sm hover:bg-[var(--surface-sunken)]"
          >
            <GearIcon width={16} height={16} />
            Settings
          </a>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-8 text-sm text-[var(--text-muted)] sm:flex-row sm:justify-between">
          <div className="flex flex-col items-center gap-1 sm:items-start">
            <span className="font-semibold text-[var(--text-strong)]">CrossScreen</span>
            <span className="text-xs">Any Screen. Any Device. Together.</span>
          </div>
          <div className="flex gap-6">
            <a href="#how-it-works" className="hover:text-[var(--text-strong)]">
              About
            </a>
            <a href="#faqs" className="hover:text-[var(--text-strong)]">
              Privacy
            </a>
            <a href="#faqs" className="hover:text-[var(--text-strong)]">
              Help
            </a>
            <a href="#get-app" className="hover:text-[var(--text-strong)]">
              Contact
            </a>
          </div>
          <span className="text-xs">Made for a more connected world</span>
        </div>
      </footer>
    </div>
  );
}
