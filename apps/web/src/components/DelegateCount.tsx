// DelegateCount: on a Conductor thread's row, the delegate icon and how many threads it delegated. Delegated threads
// have no row of their own, so the count carries their state: the needs-you diamond while one waits on Ben or failed,
// the live tint while one works, grey once all are done and seen. Clicking it opens the parent on its Details tab.
// The rules are @omni/shared/delegate-count.ts.
import { useMemo } from 'react';
import { delegateLabel, delegateSummary, type DelegateChild, type DelegateNeeds, type DelegateSummary } from '@omni/shared/delegate-count.ts';
import type { NeedsYou } from '../api.ts';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';
import { Icon, StatusDot } from './ui.tsx';

/** What the needs-you inbox says about each thread, for the count's needs and failed states. Null before it loads. */
export function needsLookup(inbox: NeedsYou | null): ((id: string) => DelegateNeeds | undefined) | undefined {
  if (!inbox) return undefined;
  const byId = new Map(inbox.items.map((i) => [i.thread.id, { blocked: i.blockers.length > 0, failed: i.result?.status === 'failed' }]));
  return (id) => byId.get(id);
}

/** The count for a Conductor thread's delegated threads, read against the live needs-you inbox. */
export function useDelegateSummary(children: readonly DelegateChild[] | undefined): DelegateSummary | null {
  const { needsYou } = useApp();
  return useMemo(() => (children?.length ? delegateSummary(children, needsLookup(needsYou)) : null), [children, needsYou]);
}

/** Where the count leads: the parent thread on its Details tab, at the card that lists what it delegated. */
export const delegatesHref = (parentId: string) => href.threadView(parentId, 'details');

const TONE: Record<DelegateSummary['state'], string> = {
  needs: 'text-fg',
  failed: 'text-fg-3',
  working: 'text-live-text',
  settled: 'text-fg-4',
};

/** The count's face: the diamond when flagged, the delegate icon and the number. */
function Face({ summary, size }: { summary: DelegateSummary; size: number }) {
  const flagged = summary.state === 'needs' || summary.state === 'failed';
  return (
    <>
      {flagged && <StatusDot status="needs" size={size > 11 ? 7 : 6} className="mr-[2px]" />}
      <Icon name="delegate" size={size} />
      {summary.total}
    </>
  );
}

const box = (size: number) =>
  `inline-flex shrink-0 items-center gap-[3px] rounded-full font-num tabular-nums ${size > 11 ? 'h-9 px-2 text-[12.5px]' : 'h-6 px-1.5 text-[11px]'}`;

/**
 * The count itself, a button laid over the right end of the row's link so it never nests inside it: the row puts a
 * DelegateCountSpace at its end to keep the title clear of it. `size` is the icon's: 11 on the desktop rail (11px
 * number), 13 on the phone (12.5px number).
 */
export function DelegateCount({
  summary,
  size = 11,
  onOpen,
  className = '',
}: {
  summary: DelegateSummary;
  size?: number;
  onOpen: () => void;
  className?: string;
}) {
  const label = delegateLabel(summary);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      title={label}
      aria-label={`${label}. Show in Details`}
      data-delegate-state={summary.state}
      className={`hov z-[2] transition-colors hover:text-fg ${box(size)} ${TONE[summary.state]} ${className}`}
    >
      <Face summary={summary} size={size} />
    </button>
  );
}

/** As wide as the count, at the end of the row's link, so the title truncates before the count laid over it. */
export function DelegateCountSpace({ summary, size = 11 }: { summary: DelegateSummary; size?: number }) {
  return (
    <span aria-hidden className={`invisible ${box(size)}`}>
      <Face summary={summary} size={size} />
    </span>
  );
}
