import { useMemo, useState } from 'react';
import { harnessLabel, OmniMark } from '../components/brand.tsx';
import { useLiveThreads } from '../components/ThreadList.tsx';
import { Segmented } from '../components/ui.tsx';
import { plural } from '../format.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { activityOf } from './activity.ts';
import { NeedsCardView } from './NeedsCard.tsx';
import { MoEmpty, MoHeader, MoRound, MoRows, MoScroll, MoSection, MoTitle } from './parts.tsx';
import { useShell } from './shell.tsx';

type Filter = 'all' | 'needs' | 'running' | 'done';
const acceptAll = () => true;
const count = (n: number) => <span className="text-[11px] text-fg-4 tabular-nums">{n}</span>;

/** Home on a phone: what needs Ben first, answerable in place, then what runs and what finished today. */
export function ActivityScreen() {
  const shell = useShell();
  const { needsYou, pinned, channel } = useApp();
  const recent = useLiveThreads('/recent?limit=60', acceptAll, 60);
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>('all');
  const a = useMemo(
    () => activityOf({ recent: recent.data, needsYou, pinned, channel: (id) => channel(id), harness: harnessLabel, now }),
    [recent.data, needsYou, pinned, channel, now],
  );
  const open = (id: string) => shell.open(href.thread(id));
  const waiting = a.needs.some((n) => n.glyph === 'needs');
  const show = (f: Filter) => filter === 'all' || filter === f;
  const date = new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <MoHeader
        left={
          <button type="button" onClick={() => shell.open(href.channel('conductor'))} aria-label="Open the Conductor" className="mo-press flex h-10 items-center gap-2 px-1.5">
            <OmniMark size={30} state={waiting ? 'attention' : a.running.length ? 'delegating' : 'idle'} />
            <span className="text-[14px] leading-none font-medium">Conductor</span>
          </button>
        }
        right={<MoRound icon="search" label="Search threads" onClick={() => shell.sheet({ name: 'search' })} />}
      />
      <MoScroll tabBar>
        <div>
          <MoTitle title="Activity" sub={`${date} · ${a.running.length} running · ${a.needs.length} ${a.needs.length === 1 ? 'needs' : 'need'} you`} />
          <div className="px-4">
            <Segmented
              label="Filter"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'All' },
                { id: 'needs', label: 'Needs you', badge: count(a.needs.length) },
                { id: 'running', label: 'Running', badge: count(a.running.length) },
                { id: 'done', label: 'Done', badge: count(a.doneToday.length) },
              ]}
            />
          </div>
        </div>
        {show('needs') && (
          <MoSection title="Needs you" count={a.needs.length}>
            {a.needs.length ? (
              <div className="flex flex-col gap-2.5">
                {a.needs.map((c) => (
                  <NeedsCardView key={c.id} card={c} />
                ))}
              </div>
            ) : (
              <MoEmpty>Nothing waits on you. {plural(a.running.length, 'thread is', 'threads are')} running.</MoEmpty>
            )}
          </MoSection>
        )}
        {filter === 'all' && a.pinned.length > 0 && (
          <MoSection title="Pinned" count={a.pinned.length}>
            <MoRows items={a.pinned} onOpen={(r) => open(r.id)} />
          </MoSection>
        )}
        {show('running') && (
          <MoSection title="Running" count={a.running.length}>
            {a.running.length ? <MoRows items={a.running} onOpen={(r) => open(r.id)} /> : <MoEmpty>Nothing is running. Tap + to start something.</MoEmpty>}
          </MoSection>
        )}
        {show('done') && (
          <MoSection title="Done today" count={a.doneToday.length}>
            {a.doneToday.length ? (
              <MoRows items={a.doneToday} onOpen={(r) => open(r.id)} />
            ) : (
              <MoEmpty>{recent.error ?? (recent.loading ? 'Loading' : 'Nothing finished yet today.')}</MoEmpty>
            )}
          </MoSection>
        )}
      </MoScroll>
    </>
  );
}
