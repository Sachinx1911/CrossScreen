import type { MouseEvent, ReactNode } from 'react';

import { GearIcon } from './Icons.tsx';
import { navigate, useRoute } from '../router.ts';

const NAV = [
  ['top', 'Home'],
  ['how-it-works', 'How it works'],
  ['features', 'Features'],
  ['get-app', 'Get the app'],
  ['faqs', 'FAQs'],
] as const;

/** The two overlapping outlined screens from home-page-desing/crossscreen-logo.svg. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 100" fill="none" className={className} aria-hidden="true">
      <rect x="8" y="14" width="75" height="55" rx="7" stroke="currentColor" strokeWidth="10" />
      <rect x="55" y="31" width="75" height="55" rx="7" stroke="currentColor" strokeWidth="10" />
    </svg>
  );
}

function scrollToSection(id: string): void {
  if (id === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

export function Layout({ children }: { children: ReactNode }) {
  const route = useRoute();
  const onHome = route.name === 'home';

  /**
   * The section links only mean anything on the landing page. From any other
   * route they first navigate home, then scroll — without this, "Home" from
   * the Settings page did nothing at all, because a bare `#top` anchor cannot
   * change the route.
   */
  const goToSection = (event: MouseEvent, id: string): void => {
    event.preventDefault();
    if (onHome) {
      scrollToSection(id);
    } else {
      navigate('/');
      // Let the landing page mount before scrolling to a section of it.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToSection(id);
        });
      });
    }
  };

  const goHome = (event: MouseEvent): void => {
    event.preventDefault();
    if (onHome) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      navigate('/');
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--surface-card)]">
        <div className="mx-auto flex h-[76px] max-w-[1180px] items-center justify-between gap-4 px-5 sm:px-7">
          <a
            href="/"
            onClick={goHome}
            className="flex items-center gap-2.5 text-[22px] font-extrabold"
          >
            <Logo className="h-8 w-8 text-brand-500" />
            CrossScreen
          </a>

          <nav className="hidden items-center gap-7 text-sm md:flex">
            {NAV.map(([id, label], i) => (
              <a
                key={id}
                href={onHome ? `#${id}` : '/'}
                onClick={(event) => {
                  if (id === 'top') goHome(event);
                  else goToSection(event, id);
                }}
                className={
                  onHome && i === 0
                    ? 'font-bold text-brand-500'
                    : 'text-[var(--text-muted)] transition hover:text-[var(--text-strong)]'
                }
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
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold ${
              route.name === 'settings'
                ? 'border-brand-500 text-brand-500'
                : 'border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-sunken)]'
            }`}
          >
            <GearIcon width={16} height={16} />
            <span className="hidden sm:inline">Settings</span>
          </a>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--border-subtle)] bg-[var(--surface-card)]">
        <div className="mx-auto flex max-w-[1180px] flex-col items-center gap-5 px-5 py-10 sm:flex-row sm:justify-between sm:px-7">
          <a href="/" onClick={goHome} className="flex items-center gap-2 text-lg font-extrabold">
            <Logo className="h-6 w-6 text-brand-500" />
            CrossScreen
          </a>
          <div className="flex gap-6 text-sm text-[var(--text-muted)]">
            <a
              href="/"
              onClick={(event) => {
                goToSection(event, 'how-it-works');
              }}
              className="hover:text-[var(--text-strong)]"
            >
              About
            </a>
            <a
              href="/"
              onClick={(event) => {
                goToSection(event, 'faqs');
              }}
              className="hover:text-[var(--text-strong)]"
            >
              Privacy
            </a>
            <a
              href="/"
              onClick={(event) => {
                goToSection(event, 'faqs');
              }}
              className="hover:text-[var(--text-strong)]"
            >
              Help
            </a>
            <a
              href="/"
              onClick={(event) => {
                goToSection(event, 'get-app');
              }}
              className="hover:text-[var(--text-strong)]"
            >
              Contact
            </a>
          </div>
          <small className="text-xs text-[var(--text-muted)]">
            Any Screen. Any Device. Together.
          </small>
        </div>
      </footer>
    </div>
  );
}
