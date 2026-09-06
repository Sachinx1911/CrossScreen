import { useState } from 'react';

import { Button } from './Primitives.tsx';

/**
 * Something to copy, with feedback that it worked.
 *
 * Without the confirmation people press it repeatedly, because a clipboard
 * write is completely invisible otherwise.
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
      // Clipboard access is refused in some contexts, and there is nothing to
      // do about it. The value is on screen and selectable either way.
      setCopied(false);
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {label}
      </p>
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
