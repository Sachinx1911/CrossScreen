import type { ReactNode } from 'react';

import { navigate } from '../router.ts';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-5 py-4">
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
            className="text-base font-semibold"
          >
            CrossScreen
          </a>
          {/* No Sign in, no Pricing. The mockup had both, and both contradict
              its own "No Account Required" promise (ADR-0007, ui-scope C2). */}
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10">{children}</main>

      <footer className="border-t border-[var(--border-subtle)] px-5 py-5 text-center text-xs text-[var(--text-muted)]">
        No account needed · End-to-end encrypted · Sessions expire on their own
      </footer>
    </div>
  );
}
