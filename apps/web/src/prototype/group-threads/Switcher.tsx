// PROTOTYPE, throwaway: the floating bar that flips screens and variants. Deliberately not Omni's look (yellow, ink,
// "PROTOTYPE") so it never reads as part of a design. Left and right arrow keys cycle variants, [ and ] or 1 to 7
// pick the screen. Only the prototype page mounts it, and only in a dev server.
import { useEffect } from 'react';
import type { Screen } from './screens/types.ts';
import { setParams } from './url-state.ts';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function Switcher({ screens, screen, variant, tech, toggle, theme }: { screens: Screen[]; screen: Screen; variant: number; tech: boolean; toggle: boolean; theme: string }) {
  const count = screen.variants.length;
  const go = (d: number) => setParams({ v: screen.variants[(variant + d + count) % count].key });
  const pick = (id: number) => setParams({ s: String(id), v: null });

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === '[' || e.key === ']') pick(((screen.id - 1 + (e.key === ']' ? 1 : -1) + screens.length) % screens.length) + 1);
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= screens.length) pick(Number(e.key));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const v = screen.variants[variant];
  const btn = 'grid h-7 min-w-7 place-items-center rounded-full px-1.5 hover:bg-black/10';
  const chip = (on: boolean) => `h-7 rounded-full px-2.5 text-[11.5px] font-semibold ${on ? 'bg-[#17181a] text-[#ffe14d]' : 'hover:bg-black/10'}`;
  return (
    <div
      data-proto-bar
      className="fixed bottom-3 left-1/2 z-[80] flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-1 rounded-full border-2 border-dashed border-[#17181a] bg-[#ffe14d] px-2 py-1 font-sans text-[12px] text-[#17181a] shadow-[0_6px_24px_rgb(0_0_0/0.25)]"
    >
      <span className="hidden px-1 text-[10px] font-bold tracking-[0.08em] sm:inline">PROTOTYPE</span>
      <select
        aria-label="Screen"
        value={screen.id}
        onChange={(e) => pick(Number(e.target.value))}
        className="h-7 max-w-[9rem] rounded-full bg-black/10 px-2 text-[12px] font-semibold outline-none sm:max-w-none"
      >
        {screens.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id}. {s.name}
          </option>
        ))}
      </select>
      <button type="button" aria-label="Previous variant" className={btn} onClick={() => go(-1)}>
        ‹
      </button>
      <span className="min-w-0 truncate px-1 font-semibold" title={v.idea}>
        {v.key} · {v.name}
      </span>
      <button type="button" aria-label="Next variant" className={btn} onClick={() => go(1)}>
        ›
      </button>
      <button type="button" aria-pressed={tech} title="Show technical details" className={chip(tech)} onClick={() => setParams({ tech: tech ? null : '1' })}>
        Tech
      </button>
      {screen.toggle && (
        <button type="button" aria-pressed={toggle} className={chip(toggle)} onClick={() => setParams({ [screen.toggle!.key]: toggle ? null : '1' })}>
          {screen.toggle.label}
        </button>
      )}
      <button
        type="button"
        title="Light or dark"
        className={btn}
        onClick={() => {
          const next = theme === 'dark' ? 'light' : 'dark';
          document.documentElement.dataset.theme = next;
          setParams({ theme: next });
        }}
      >
        {theme === 'dark' ? '☾' : '☀'}
      </button>
    </div>
  );
}
