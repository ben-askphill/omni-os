import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  facetOptions,
  filterCount,
  FACETS,
  inScope,
  pickedFilters,
  toggleFilter,
  PR_FACETS,
  PR_SORTS,
  type ListedPR,
  type PRGroup,
  type PRQuery,
} from '@omni/shared/pr-query.ts';
import { Button, Chip, Icon, Picker, type IconName } from '../components/ui.tsx';
import { PageToolbar, RefreshButton, SearchField } from '../components/ui/feedback.tsx';
import { isMenuMoveKey, moveFocus } from '../components/ContextMenuParts.tsx';
import { useAnchoredPopover } from '../components/ui/use-anchored-popover.ts';
import { useExit } from '../components/ui/use-exit.ts';

/** Takes the next query, or how to make it from the current one so presses in one frame all land. */
export type SetPRQuery = (next: PRQuery | ((q: PRQuery) => PRQuery)) => void;

const pill =
  'press inline-flex h-8 shrink-0 items-center gap-2 rounded-full bg-surface-2 px-3 text-[12.5px] font-medium text-fg transition-colors hover:bg-surface-3';

/** Search, sort, filters and the repo to list, then refresh on the right. The repo picker shows only when there is a choice. */
export function PRToolbar({
  q,
  set,
  prs,
  repos,
  onRefresh,
  busy,
}: {
  q: PRQuery;
  set: SetPRQuery;
  prs: ListedPR[];
  repos: string[];
  onRefresh?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <PageToolbar right={onRefresh && <RefreshButton onClick={onRefresh} busy={busy} label="Refresh pull requests" />}>
        <SearchField value={q.search} onChange={(search) => set((q) => ({ ...q, search }))} placeholder="Search pull requests, or label:bug" label="Search pull requests" />
        <div className="relative flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <Picker
            className="min-w-0"
            label="Sort"
            value={q.sort}
            options={PR_SORTS.map((s) => ({ value: s.value, label: s.label, avatar: false }))}
            onChange={(sort) => set((q) => ({ ...q, sort }))}
            prefix={<Icon name="sort" size={14} />}
          />
          <FilterMenu q={q} set={set} prs={inScope(prs, q.repo)} />
          {repos.length > 1 && (
            <Picker
              className="min-w-0 max-sm:static"
              label="Repo"
              value={q.repo ?? ''}
              options={[{ value: '', label: 'All repos', sub: 'Every channel’s repo', avatar: false }, ...repos.map((r) => ({ value: r, label: r, avatar: false as const }))]}
              onChange={(r) => set((q) => ({ ...q, repo: r || null }))}
              prefix={<Icon name="plug" size={14} />}
              align="right"
            />
          )}
        </div>
      </PageToolbar>
      <PickedChips q={q} set={set} />
    </div>
  );
}

function FilterMenu({ q, set, prs }: { q: PRQuery; set: SetPRQuery; prs: ListedPR[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const n = filterCount(q.filters);
  // A popover tethered to the button. It takes the focus on its first item; the arrows, Home and End walk the items,
  // Escape closes it and puts the focus back on the button, and Tab closes it and moves on.
  const pop = useAnchoredPopover({ open, onDismiss: () => setOpen(false), wrap, trigger, panel, align: 'right', initialFocus: () => panel.current?.querySelector<HTMLElement>('[role^="menuitem"]') });
  const exit = useExit(open, panel);
  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (isMenuMoveKey(e.key)) {
      e.preventDefault();
      moveFocus(panel, e.key);
    } else if (e.key === 'Tab') setOpen(false);
  };
  const sections = PR_FACETS.map((facet) => ({ facet, options: facetOptions(prs, facet, q.filters[facet]) })).filter((s) => s.options.length);
  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        {...pop.triggerProps}
        onClick={() => setOpen(!pop.clickCloses())}
        onKeyDown={(e) => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
          e.preventDefault();
          setOpen(true);
        }}
        className={pill}
      >
        <Icon name="sliders" size={14} className="text-fg-3" />
        Filters
        {n > 0 && <Chip tone="ink">{n}</Chip>}
      </button>
      {exit.shown && (
        <div
          ref={panel}
          {...pop.panelProps}
          role="menu"
          aria-label="Filters"
          data-closing={exit.closing || undefined}
          onKeyDown={onMenuKey}
          className={`pik-card w-[min(300px,calc(100vw-32px))] ${pop.inlineClass}`}
        >
          <div className="scroll-thin max-h-[min(420px,70vh)] overflow-y-auto">
            {sections.map(({ facet, options }) => (
              <div key={facet} role="group" aria-label={FACETS[facet].title} className="pb-1">
                <div className="caption px-2 pt-2 pb-1">{FACETS[facet].title}</div>
                {options.map((o) => {
                  const on = !!q.filters[facet]?.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      tabIndex={-1}
                      onClick={() => set((q) => ({ ...q, filters: toggleFilter(q.filters, facet, o.value) }))}
                      className="pik-row min-h-9 hover:bg-[var(--wash)] focus-visible:bg-[var(--wash)]"
                    >
                      <span className="pik-mark">{on && <Icon name="check" size={12} strokeWidth={2.6} />}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{o.label}</span>
                      <span className="font-num text-[11.5px] text-fg-3">{o.count}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {n > 0 && (
            <div className="mt-1 border-t border-line px-1 pt-1.5">
              <Button size="sm" variant="ghost" icon="x" role="menuitem" tabIndex={-1} onClick={() => set((q) => ({ ...q, filters: {} }))}>
                Clear filters
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One chip per picked filter. A press removes it. */
function PickedChips({ q, set }: { q: PRQuery; set: SetPRQuery }) {
  const picked = pickedFilters(q.filters);
  if (!picked.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {picked.map((p) => (
        <button
          key={`${p.facet}:${p.value}`}
          type="button"
          aria-label={`Remove ${FACETS[p.facet].title} ${p.label}`}
          onClick={() => set((q) => ({ ...q, filters: toggleFilter(q.filters, p.facet, p.value) }))}
          className="press"
        >
          <Chip className="gap-1 pr-1.5 hover:bg-surface-3">
            <span className="text-fg-3">{FACETS[p.facet].title}</span>
            {p.label}
            <Icon name="x" size={11} />
          </Chip>
        </button>
      ))}
      <button type="button" onClick={() => set((q) => ({ ...q, filters: {} }))} className="px-1.5 text-[11.5px] font-medium text-fg-3 hover:text-fg">
        Clear
      </button>
    </div>
  );
}

/** A group's line: its icon, name and how many it shows, then a rule. */
export function PRGroupHead({ g, className = '' }: { g: PRGroup<unknown>; className?: string }) {
  return (
    <div className={`caption flex items-center gap-2 ${className}`}>
      <Icon name={g.icon as IconName} size={14} />
      {g.label}
      <span className="font-num text-fg-3">{g.prs.length}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
