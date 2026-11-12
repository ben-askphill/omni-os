import { useState } from 'react';
import type { Thread } from '../api.ts';
import { NewThreadComposer } from '../components/Composer.tsx';
import { EmptyNote, NeedsYouSection } from '../components/NeedsYou.tsx';
import { ThreadGroups, useLiveThreads } from '../components/ThreadList.tsx';
import { OmniMark } from '../components/brand.tsx';
import { Segmented, StatusDot, asksForYou } from '../components/ui.tsx';
import { threadGlyph } from '@omni/shared/status.ts';
import { pageColumn } from '../components/ui/feedback.tsx';
import { greeting } from '../greeting.ts';
import { useApp } from '../store.tsx';
import { isWorking } from '@omni/shared/delegate-count.ts';

const acceptAll = () => true;

type Filter = 'all' | 'active' | 'needs';
const FILTERS: Record<Filter, (t: Thread) => boolean> = {
  all: () => true,
  active: isWorking,
  // A thread Ben marked done has had its look.
  needs: (t) => asksForYou(threadGlyph(t)) && !t.done_at,
};

function Pulse() {
  const { status } = useApp();
  if (!status) return null;
  const busy = status.running > 0;
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-full bg-surface px-3 font-num text-[11.5px] text-fg-2 tabular-nums">
      <StatusDot status={busy ? 'running' : 'idle'} size={7} />
      {busy ? `${status.running} running` : 'Nothing running'}
      {status.queued > 0 && <span className="text-fg-3">· {status.queued} queued</span>}
    </span>
  );
}

export function HomePage() {
  const recent = useLiveThreads('/recent?limit=60', acceptAll, 60);
  const [filter, setFilter] = useState<Filter>('all');
  const all = recent.data;
  const { status, needsYou, profile } = useApp();
  // Needs you and Unread list these above, so the unfiltered list leaves them out: one row per thread on the page.
  const above = new Set(needsYou?.items.map((i) => i.thread.id));
  const shown = all?.filter((t) => FILTERS[filter](t) && (filter !== 'all' || !above.has(t.id)));
  const count = (f: Filter) => all?.filter(FILTERS[f]).length ?? 0;
  const markState = needsYou?.items.length || all?.some(FILTERS.needs) ? 'attention' : status && status.running > 0 ? 'thinking' : 'idle';
  const badge = (n: number) => (n ? <span className="font-num text-[10.5px] text-fg-3 tabular-nums">{n}</span> : null);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className={`${pageColumn('measure')} pt-8 pb-16 md:pt-16`}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <OmniMark size={40} state={markState} />
            <div className="caption mt-4 mb-2.5">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h1 className="font-display text-[length:var(--fs-title)] leading-[1.1] md:text-[length:var(--fs-title-lg)]">{greeting(new Date().getHours(), profile?.name ?? '')}</h1>
          </div>
          <Pulse />
        </div>
        <NewThreadComposer big />
        <NeedsYouSection inbox={needsYou} showChannel />
        <div className="mt-10">
          <div className="mb-2 flex items-center justify-between gap-3 px-3 md:px-3.5">
            <h2 className="font-display text-[length:var(--fs-heading)]">Recent</h2>
            <Segmented
              size="sm"
              label="Filter threads"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active', badge: badge(count('active')) },
                { id: 'needs', label: 'Needs you', badge: badge(count('needs')) },
              ]}
            />
          </div>
          <ThreadGroups
            threads={shown}
            loading={recent.loading}
            error={recent.error}
            onRetry={recent.reload}
            showChannel
            empty={
              filter === 'all' ? (
                <EmptyNote icon="message">
                  {all?.length ? 'Every recent thread is listed above.' : 'Nothing here yet. Start a thread above. Every task gets its own thread in a channel, so it stays findable.'}
                </EmptyNote>
              ) : filter === 'active' ? (
                <EmptyNote icon="clock">Nothing running. Threads that are running or queued show up here.</EmptyNote>
              ) : (
                <EmptyNote icon="check">Nothing needs you. Recent threads that failed, wait on you or hit a usage limit show up here.</EmptyNote>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
