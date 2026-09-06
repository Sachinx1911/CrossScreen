import type { QualityMode } from '@crossscreen/webrtc-core';

/**
 * Sharp text, or smooth motion.
 *
 * Not a quality slider — two opposite answers to the same question, and
 * neither is right in general. `text` holds resolution and lets the frame rate
 * fall, which keeps a spreadsheet readable and makes a playing video look
 * frozen. `motion` does the reverse.
 *
 * Text is the default because the product exists for showing someone how to do
 * something. Sharing a video is the case where that is wrong, and it is common
 * enough to need a control rather than an explanation.
 */
export function QualityToggle({
  mode,
  onChange,
}: {
  mode: QualityMode;
  onChange: (mode: QualityMode) => void;
}) {
  const options: { value: QualityMode; label: string; hint: string }[] = [
    { value: 'text', label: 'Sharp text', hint: 'Best for documents and code' },
    { value: 'motion', label: 'Smooth video', hint: 'Best for anything moving' },
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
