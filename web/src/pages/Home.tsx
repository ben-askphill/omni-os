import { useState } from 'react';
import type { Thread } from '../api.ts';
import { NewThreadComposer } from '../components/Composer.tsx';
import { ThreadGroups, useLiveThreads } from '../components/ThreadList.tsx';
import { OmniMark } from '../components/brand.tsx';
import { Empty, Segmented, StatusDot, glyphFor } from '../components/ui.tsx';
import { useApp } from '../store.tsx';

const acceptAll = () => true;

type Filter = 'all' | 'active' | 'failed';
const FILTERS: Record<Filter, (t: Thread) => boolean> = {
  all: () => true,
  active: (t) => t.status === 'running' || t.status === 'queued',
  failed: (t) => t.status === 'failed' || t.status === 'stopped',
};

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Late one, Ben' : h < 12 ? 'Morning, Ben' : h < 18 ? 'Afternoon, Ben' : 'Evening, Ben';
}

function Pulse() {
  const { status } = useApp();
  if (!status) return null;
  const busy = status.running > 0;
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-full bg-surface px-3 font-num text-[11.5px] text-fg-2 tabular-nums">
      <StatusDot status={busy ? 'running' : 'idle'} size={7} />
      {busy ? `${status.running} running` : 'All quiet'}
      {status.queued > 0 && <span className="text-fg-4">· {status.queued} queued</span>}
    </span>
  );
}

export function HomePage() {
  const recent = useLiveThreads('/recent?limit=60', acceptAll, 60);
  const [filter, setFilter] = useState<Filter>('all');
  const all = recent.data;
  const shown = all?.filter(FILTERS[filter]);
  const count = (f: Filter) => all?.filter(FILTERS[f]).length ?? 0;
  const { status } = useApp();
  const markState = all?.some((t) => glyphFor(t.status) === 'needs') ? 'attention' : status && status.running > 0 ? 'thinking' : 'idle';
  const badge = (n: number) => (n ? <span className="font-num text-[10.5px] text-fg-4 tabular-nums">{n}</span> : null);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 md:px-8 md:pt-16">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <OmniMark size={40} state={markState} />
            <div className="caption mt-4 mb-2.5">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h1 className="font-display text-[30px] leading-[1.05] md:text-[38px]">{greeting()}</h1>
          </div>
          <Pulse />
        </div>
        <NewThreadComposer big />
        <div className="mt-10">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <h2 className="font-display text-[17px]">Recent</h2>
            <Segmented
              size="sm"
              label="Filter threads"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active', badge: badge(count('active')) },
                { id: 'failed', label: 'Needs a look', badge: badge(count('failed')) },
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
                <Empty icon="message" title="Nothing here yet">
                  Start a thread above. Every task gets its own thread in a channel, so it stays findable.
                </Empty>
              ) : (
                <Empty icon="check" title={filter === 'active' ? 'Nothing running' : 'Nothing failed'}>
                  {filter === 'active' ? 'Threads that are running or queued show up here.' : 'Failed and stopped threads from the recent list show up here.'}
                </Empty>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
