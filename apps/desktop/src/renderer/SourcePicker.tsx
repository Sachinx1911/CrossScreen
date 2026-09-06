import type { CaptureSource } from '@crossscreen/capture';

/**
 * Choosing what to share.
 *
 * The reason the desktop app exists at all: a browser can only offer whatever
 * dialog it draws, and this one shows live thumbnails grouped so that a whole
 * screen and a single window are not the same kind of choice.
 *
 * Screens first, because sharing everything is the more consequential option
 * and burying it makes people pick a window they did not want.
 */
export function SourcePicker({
  sources,
  onChoose,
}: {
  sources: CaptureSource[];
  onChoose: (source: CaptureSource) => void;
}) {
  const screens = sources.filter((s) => s.kind === 'screen');
  const windows = sources.filter((s) => s.kind === 'window');

  return (
    <div className="space-y-6">
      {[
        { title: 'Entire screen', items: screens },
        { title: 'A window', items: windows },
      ].map(({ title, items }) =>
        items.length === 0 ? null : (
          <section key={title}>
            <h2 className="mb-3 text-sm font-semibold text-[var(--text-muted)]">{title}</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((source) => (
                <li key={source.id}>
                  <button
                    onClick={() => {
                      onChoose(source);
                    }}
                    className="card hover:border-brand-500 w-full overflow-hidden p-0 text-left transition"
                  >
                    {source.thumbnail !== undefined && (
                      <img
                        src={source.thumbnail}
                        alt=""
                        className="aspect-video w-full bg-black object-contain"
                      />
                    )}
                    <span className="block truncate px-3 py-2 text-xs">{source.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
