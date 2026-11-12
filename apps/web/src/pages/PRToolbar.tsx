import { useRef, useState } from 'react';
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
import { useDismissable } from '../components/ui/use-dismissable.ts';

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
  const n = filterCount(q.filters);
  useDismissable(open, () => setOpen(false), { root: wrap });
  const sections = PR_FACETS.map((facet) => ({ facet, options: facetOptions(prs, facet, q.filters[facet]) })).filter((s) => s.options.length);
  return (
    // On a phone this menu and the repo's hang from the pills' row, not the button, so they stay on screen.
    <div ref={wrap} className="sm:relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className={pill}>
        <Icon name="sliders" size={14} className="text-fg-3" />
        Filters
        {n > 0 && <Chip tone="ink">{n}</Chip>}
      </button>
      {open && (
        <div role="menu" aria-label="Filters" className="pik-card top-[calc(100%+8px)] right-0 w-[min(300px,calc(100vw-32px))]">
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
                      aria-selected={on}
                      onClick={() => set((q) => ({ ...q, filters: toggleFilter(q.filters, facet, o.value) }))}
                      className="pik-row min-h-9 hover:bg-[var(--wash)]"
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
              <Button size="sm" variant="ghost" icon="x" onClick={() => set((q) => ({ ...q, filters: {} }))}>
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
