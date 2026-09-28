import { useCallback, useEffect, useRef, useState } from 'react';
import type { SlashCommand } from '../../../shared/slash.ts';
import { api, type CommandList } from '../api.ts';
import { SOURCE_TAG, type MenuSection } from '../../../shared/slash-menu.ts';
import { Loader } from './ui.tsx';

/**
 * The command list for a `/` menu: a thread's (`thread=<id>`), or the one a new thread would get
 * (`harness=<id>&channel=<id>`). `load` sets the cached list at once, then the fresh one when a
 * refresh was running. The server probes at most every 30 seconds, so calling it often is cheap.
 * A new query has no list until it loads, and `load` changes with it.
 */
export function useCommands(query: string) {
  // The list with the query it answers, so another query never shows it.
  const [got, setGot] = useState<{ query: string; list: CommandList } | null>(null);
  const current = useRef(query);

  useEffect(() => {
    current.current = query;
  }, [query]);

  const load = useCallback(async () => {
    const path = `/commands?${query}`;
    const mine = (prev: typeof got) => (prev?.query === query ? prev.list : null);
    // Never swap a list for an older one when two loads overlap.
    const take = (next: CommandList) =>
      current.current === query &&
      setGot((prev) => {
        const had = mine(prev);
        return had?.fetchedAt && (next.fetchedAt ?? 0) < had.fetchedAt ? prev : { query, list: next };
      });
    try {
      take(await api.get<CommandList>(path));
      take(await api.get<CommandList>(`${path}&wait=1`));
    } catch {
      if (current.current === query) setGot((prev) => (mine(prev) ? prev : { query, list: { status: 'unavailable', commands: [], fetchedAt: null } }));
    }
  }, [query]);

  return { list: got?.query === query ? got.list : null, load };
}

export const optionId = (menuId: string, i: number) => `${menuId}-${i}`;

/**
 * The `/` menu above a composer, or `below` one near the top of the page. Focus stays in the
 * composer, which moves `active` with the arrow keys; a click or tap picks a row.
 */
export function SlashMenu({
  id,
  list,
  sections,
  active,
  onActive,
  onPick,
  below,
}: {
  id: string;
  list: CommandList | null;
  sections: MenuSection[];
  active: number;
  onActive: (i: number) => void;
  onPick: (c: SlashCommand) => void;
  below?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, sections]);

  let i = -1;
  return (
    <div
      ref={ref}
      id={id}
      role="listbox"
      aria-label="Commands"
      // Keep focus (and the phone keyboard) in the composer.
      onMouseDown={(e) => e.preventDefault()}
      className={`fade-in scroll-thin absolute inset-x-0 z-20 max-h-[min(22rem,45vh)] overflow-y-auto rounded-[22px] bg-elev p-1.5 shadow-[var(--shadow-menu)] ${below ? 'top-full mt-2' : 'bottom-full mb-2'}`}
    >
      {/* A thread's menu lists Omni's own commands either way, so say why the harness's are missing. */}
      {list?.status === 'unavailable' && (
        <div className="px-3 py-2.5 text-[12.5px] text-fg-3">
          Couldn't read the commands.
          {list.fix && (
            <>
              {' '}
              Run <code className="rounded bg-surface-2 px-1 font-mono text-[12px] text-fg-2">{list.fix}</code> in a terminal to see why.
            </>
          )}
        </div>
      )}
      {(!list || list.status === 'loading') && (
        <div className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-fg-3">
          <Loader size={13} /> Loading commands
        </div>
      )}
      {sections.map((s) => (
        <div key={s.label ?? 'matches'} role="group" aria-label={s.label ?? 'Matches'}>
          {s.label && <div className="caption px-3 pt-2 pb-1">{s.label}</div>}
          {s.commands.map((c) => {
            const k = ++i;
            return (
              <div
                key={c.name}
                id={optionId(id, k)}
                role="option"
                aria-selected={k === active}
                data-active={k === active || undefined}
                onMouseMove={() => k !== active && onActive(k)}
                onClick={() => onPick(c)}
                className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-1.5 data-[active]:bg-[var(--wash)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[13px] font-medium text-fg">/{c.name}</span>
                    {c.argumentHint && <span className="truncate font-mono text-[12px] text-fg-4">{c.argumentHint}</span>}
                  </span>
                  {c.description && <span className="block truncate text-[11.5px] text-fg-4">{c.description}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-px text-[11px] text-fg-3">{SOURCE_TAG[c.source]}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
