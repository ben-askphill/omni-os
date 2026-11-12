import { useEffect, useMemo, useRef, useState } from 'react';
import { Marked, paletteItems, queryWords, type Item } from './command-palette/items.tsx';
import { useApi, type Thread } from '../api.ts';
import { useRoute } from '../router.ts';
import { useApp } from '../store.tsx';
import { Icon, Kbd, Thumb, useSlidingThumb } from './ui.tsx';
import { SCRIM } from './ui/modal.tsx';
import { KbdFooter, overlayRow } from './ui/overlay.tsx';

/** ⌘K: jump to a page, channel or recent thread, or search everything. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { channels, openThread } = useApp();
  const route = useRoute();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recent = useApi<Thread[]>(open ? '/recent?limit=40' : null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setCursor(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  const items = useMemo<Item[]>(() => paletteItems(q, channels, recent.data, route, openThread), [q, channels, recent.data, route, openThread]);
  const words = useMemo(() => queryWords(q), [q]);

  useEffect(() => setCursor(0), [q]);
  const safeCursor = Math.min(cursor, Math.max(0, items.length - 1));
  const box = useSlidingThumb(listRef, `${open}:${safeCursor}:${items.length}`, true, '[data-active="true"]');

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [safeCursor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const run = (i: Item | undefined) => {
    if (!i) return;
    onClose();
    i.run();
  };

  const groups: { name: string; items: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const g = groups.at(-1);
    if (g?.name === item.group) g.items.push({ item, index });
    else groups.push({ name: item.group, items: [{ item, index }] });
  });

  return (
    <div className={`${SCRIM} items-start px-3 pt-[max(12px,10vh)]`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Command menu" className="pop-in flex max-h-[min(640px,80vh)] w-full max-w-[620px] flex-col overflow-hidden rounded-[var(--r-3xl)] bg-elev shadow-[var(--shadow-menu)]">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line pr-4 pl-6">
          <Icon name="search" size={18} className="text-fg-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(items.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(items[safeCursor]);
              }
            }}
            placeholder="Search or jump to"
            aria-label="Search or jump to"
            role="combobox"
            aria-expanded="true"
            aria-controls="omni-cmdk-list"
            aria-activedescendant={items[safeCursor] ? `cmdk-${items[safeCursor].id}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-4"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="omni-cmdk-list" role="listbox" className="scroll-thin relative min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <Thumb box={box} tone="wash" className="!rounded-[var(--r-md)]" />
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name}>
              <div className="caption px-4 pt-3 pb-2">{g.name}</div>
              {g.items.map(({ item, index }) => (
                <button
                  key={item.id}
                  id={`cmdk-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === safeCursor}
                  data-active={index === safeCursor}
                  onMouseMove={() => index !== safeCursor && setCursor(index)}
                  onClick={() => run(item)}
                  className={`relative z-[1] ${overlayRow('lg', false)}`}
                >
                  {item.lead}
                  {/* The sub gives up its width first, so a long label is cut once, not twice. */}
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="min-w-0 truncate text-[13.5px] text-fg">
                      <Marked text={item.label} words={words} />
                    </span>
                    {item.sub && (
                      <span className="min-w-[4ch] shrink-[100] truncate text-[12px] text-fg-3">
                        <Marked text={item.sub} words={words} />
                      </span>
                    )}
                  </span>
                  {item.right}
                  {index === safeCursor && <Icon name="arrowRight" size={14} className="text-fg-3" />}
                </button>
              ))}
            </div>
          ))}
          {!items.length && <div className="px-4 py-10 text-center text-[13px] text-fg-3">{recent.loading ? 'Loading' : 'Nothing matches'}</div>}
        </div>
        <KbdFooter
          className="px-6"
          hints={[
            [['↑', '↓'], 'move'],
            [['↵'], 'open'],
            [['esc'], 'close'],
          ]}
        />
      </div>
    </div>
  );
}
