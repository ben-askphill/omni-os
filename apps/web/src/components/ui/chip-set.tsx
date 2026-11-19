// A row of toggle chips, each one on or off (aria-pressed). The automation editor and onboarding pick with it.

/** Small toggle chips for picking several of a few things: channels, webhook events, the tools onboarding asks about. */
export function ChipSet({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={`hov inline-flex h-7 max-w-full items-center rounded-full px-3 text-[12.5px] [--hov:var(--surface-2)] ${on ? 'bg-fg text-bg [--hov:var(--fg-2)]' : 'bg-bg text-fg-2 shadow-[inset_0_0_0_1px_var(--line)]'}`}
          >
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
