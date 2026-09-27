import { useCallback, useEffect, useRef, useState } from 'react';
import type { SlashCommand } from '../../../shared/slash.ts';
import { api, type CommandList } from '../api.ts';
import { SOURCE_TAG, type MenuSection } from '../slash-menu.ts';
import { Spinner } from './ui.tsx';

/**
 * A thread's command list for its `/` menu. `load` sets the cached list at once, then the fresh one
 * when a refresh was running. The server probes at most every 30 seconds, so calling it often is cheap.
 */
export function useCommands(threadId: string) {
  const [list, setList] = useState<CommandList | null>(null);
  const current = useRef(threadId);

  useEffect(() => {
    current.current = threadId;
    setList(null);
  }, [threadId]);

  const load = useCallback(async () => {
    const path = `/commands?thread=${encodeURIComponent(threadId)}`;
    // Never swap a list for an older one when two loads overlap.
    const take = (next: CommandList) =>
      current.current === threadId &&
      setList((prev) => (prev?.fetchedAt && (next.fetchedAt ?? 0) < prev.fetchedAt ? prev : next));
    try {
      take(await api.get<CommandList>(path));
      take(await api.get<CommandList>(`${path}&wait=1`));
    } catch {
      if (current.current === threadId) setList((prev) => prev ?? { status: 'unavailable', commands: [], fetchedAt: null });
    }
  }, [threadId]);

  return { list, load };
}

export const optionId = (menuId: string, i: number) => `${menuId}-${i}`;

/**
 * The `/` menu above a composer. Focus stays in the composer, which moves `active` with the arrow
 * keys; a click or tap picks a row.
 */
export function SlashMenu({
  id,
  list,
  sections,
  active,
  onActive,
  onPick,
}: {
  id: string;
  list: CommandList | null;
  sections: MenuSection[];
  active: number;
  onActive: (i: number) => void;
  onPick: (c: SlashCommand) => void;
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
      className="fade-in scroll-thin absolute inset-x-0 bottom-full z-20 mb-2 max-h-[min(22rem,45vh)] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-menu)]"
    >
      {/* Omni's own commands are listed either way, so say why the harness's are missing. */}
      {list?.status === 'unavailable' && (
        <div className="px-2.5 py-2 text-[12.5px] text-fg-3">
          Couldn't read this thread's commands.
          {list.fix && (
            <>
              {' '}
              Run <code className="rounded bg-surface-2 px-1 font-mono text-[12px] text-fg-2">{list.fix}</code> in a terminal to see why.
            </>
          )}
        </div>
      )}
      {(!list || list.status === 'loading') && (
        <div className="flex items-center gap-2 px-2.5 py-2 text-[12.5px] text-fg-3">
          <Spinner size={13} /> Loading commands
        </div>
      )}
      {sections.map((s) => (
        <div key={s.label ?? 'matches'} role="group" aria-label={s.label ?? 'Matches'}>
          {s.label && <div className="label-mono px-2.5 pt-2 pb-1">{s.label}</div>}
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
                className="flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-1.5 data-[active]:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[13px] font-medium text-fg">/{c.name}</span>
                    {c.argumentHint && <span className="truncate font-mono text-[12px] text-fg-4">{c.argumentHint}</span>}
                  </span>
                  {c.description && <span className="block truncate text-[12px] text-fg-3">{c.description}</span>}
                </span>
                <span className="mt-0.5 shrink-0 rounded bg-surface-3 px-1.5 py-px text-[10.5px] text-fg-3">{SOURCE_TAG[c.source]}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
