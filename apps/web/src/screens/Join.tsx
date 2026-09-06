import { useEffect, useState } from 'react';

import { extractJoinToken, isValidJoinCode, normaliseJoinCode } from '@crossscreen/protocol';

import { Button, Card, Notice } from '../components/Primitives.tsx';
import { navigate } from '../router.ts';

/**
 * Entering a code, or arriving by link.
 *
 * The one screen a non-technical person meets first, often on a phone, often
 * while someone reads a code to them over a call. So: a numeric keypad on
 * mobile, spaces and dashes accepted, and a pasted link understood rather than
 * rejected for not being a code.
 */
export function Join({
  token,
  onJoin,
}: {
  token?: string;
  onJoin: (input: { joinCode?: string; joinToken?: string }) => void;
}) {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | undefined>();

  // Arrived by link: there is nothing to ask, so do not ask it.
  //
  // In an effect rather than during render. Calling `onJoin` inline updated a
  // parent while this component was rendering, which React warns about and is
  // genuinely wrong — the two components would be describing different states
  // in the same pass.
  useEffect(() => {
    if (token !== undefined) onJoin({ joinToken: token });
  }, [token, onJoin]);

  if (token !== undefined) {
    return <Card className="mx-auto max-w-md">Joining…</Card>;
  }

  // The handler is inlined at `onSubmit` below rather than annotated here:
  // React 19's types deprecate both FormEvent and FormEventHandler, and
  // contextual typing from the JSX prop needs no name at all.
  const submit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    setProblem(undefined);

    const pasted = extractJoinToken(value);
    if (pasted !== null) {
      onJoin({ joinToken: pasted });
      return;
    }

    const code = normaliseJoinCode(value);
    if (!isValidJoinCode(code)) {
      setProblem('A session code is six digits. Check it and try again.');
      return;
    }
    onJoin({ joinCode: code });
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-md">
      <Card className="space-y-5">
        <h1 className="text-2xl font-semibold">Join a session</h1>

        <div>
          <label htmlFor="code" className="mb-1.5 block text-sm font-medium">
            Session code, or paste a link
          </label>
          <input
            id="code"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            // Digits, but not `type="number"`: a pasted link has to be accepted
            // here too, and a number field silently discards it.
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="482 719"
            aria-describedby={problem === undefined ? undefined : 'code-problem'}
            className="session-code w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3 text-2xl"
          />
        </div>

        {/* The id goes on the Notice itself. Wrapping it in a <p> nested one
            paragraph inside another, which is invalid HTML — caught by the
            end-to-end run, not by any type or lint check. */}
        {problem !== undefined && (
          <Notice tone="error" id="code-problem">
            {problem}
          </Notice>
        )}

        <Button type="submit" className="w-full">
          Join session
        </Button>

        <p className="text-center text-xs text-[var(--text-muted)]">
          The host will be asked to let you in.
        </p>
      </Card>

      <p className="mt-5 text-center">
        <button
          type="button"
          onClick={() => {
            navigate('/');
          }}
          className="text-sm text-[var(--text-muted)] underline"
        >
          Back
        </button>
      </p>
    </form>
  );
}
