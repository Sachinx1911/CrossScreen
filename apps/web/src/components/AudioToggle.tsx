/**
 * Whether to include system audio in the share.
 *
 * ui-scope.md §1 C4: the mockup showed this on by default; architecture §12
 * corrects that — system audio only works on some browser/OS combinations
 * (Firefox and Safari cannot do it via `getDisplayMedia` at all), so
 * defaulting to a promise the platform cannot always keep is worse than
 * asking. Shown always and disabled rather than hidden where unsupported,
 * so the feature's existence and its limit are both visible in one place.
 */
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
      title={available ? undefined : 'Not available in this browser yet. Chrome or Edge can.'}
    >
      <span>
        <span className="block font-medium">Share system audio</span>
        <span className="block text-xs text-[var(--text-muted)]">
          {available ? 'Include sound playing on your computer' : 'Not available in this browser'}
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
