import { useMemo, useState } from 'react';
import { harnessLabel, OmniMark } from '../components/brand.tsx';
import { useLiveThreads } from '../components/ThreadList.tsx';
import { Segmented } from '../components/ui.tsx';
import { plural } from '../format.ts';
import { href } from '../router.ts';
import { recentThreadGroups, recentThreads, runningThreadGroups, type ThreadRowGroup } from '../sidebar-lists.ts';
import { useApp, useNow } from '../store.tsx';
import { activityOf } from './activity.ts';
import { rowOf, type RowItem } from './rows.ts';
import { MobileHandoffGroup } from './ChannelsScreen.tsx';
import { NeedsCardView } from './NeedsCard.tsx';
import { MoEmpty, MoHeader, MoRound, MoRows, MoScroll, MoSection, MoTitle } from './parts.tsx';
import { useShell } from './shell.tsx';

type Filter = 'all' | 'needs' | 'running' | 'done';
const acceptAll = () => true;
const count = (n: number) => <span className="text-[11px] text-fg-4 tabular-nums">{n}</span>;

/** Home on a phone: what needs Ben first, answerable in place, then what runs and what finished today. */
export function ActivityScreen() {
  const shell = useShell();
  const { needsYou, pinned, channels, channel } = useApp();
  const recent = useLiveThreads('/recent?limit=60', acceptAll, 60);
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>('all');
  const a = useMemo(
    () => activityOf({ recent: recent.data, needsYou, pinned, latest: recentThreads(channels), channel: (id) => channel(id), harness: harnessLabel, now }),
    [recent.data, needsYou, pinned, channels, channel, now],
  );
  const runningGroups = useMemo(() => runningThreadGroups(channels), [channels]);
  const latestGroups = useMemo(() => recentThreadGroups(channels), [channels]);
  const runningCount = countGroupedRows(a.running, runningGroups);
  const latestCount = countGroupedRows(a.latest, latestGroups, true);
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
                { id: 'running', label: 'Running', badge: count(runningCount) },
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
        {/* As the sidebar: Running (hidden under All while nothing runs), Pinned, then Recent threads. */}
        {(filter === 'running' || (filter === 'all' && a.running.length > 0)) && (
          <MoSection title="Running" count={runningCount}>
            {a.running.length ? <ActivityThreadRows idPrefix="activity-running" items={a.running} groups={runningGroups} channel={channel} now={now} onOpen={(r) => open(r.id)} /> : <MoEmpty>Nothing is running. Tap + to start something.</MoEmpty>}
          </MoSection>
        )}
        {filter === 'all' && a.pinned.length > 0 && (
          <MoSection title="Pinned" count={a.pinned.length}>
            <MoRows items={a.pinned} onOpen={(r) => open(r.id)} />
          </MoSection>
        )}
        {filter === 'all' && a.latest.length > 0 && (
          <MoSection title="Recent threads" count={latestCount}>
            <ActivityThreadRows idPrefix="activity-recent" items={a.latest} groups={latestGroups} channel={channel} now={now} includeInactiveChildren onOpen={(r) => open(r.id)} />
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

function countGroupedRows(items: RowItem[], groups: ThreadRowGroup[], includeInactiveChildren = false) {
  const ids = new Set(items.map((item) => item.id));
  const visible = groups.filter((group) => ids.has(group.thread.id) || group.children.some((child) => ids.has(child.id)));
  const parentIds = new Set(visible.map((group) => group.thread.id));
  const childIds = new Set(visible.flatMap((group) => group.children.map((child) => child.id)));
  return visible.reduce((count, group) => count + 1 + (includeInactiveChildren ? group.children.length : group.children.filter((child) => ids.has(child.id)).length), 0)
    + items.filter((item) => !parentIds.has(item.id) && !childIds.has(item.id)).length;
}

function ActivityThreadRows({ items, groups, channel, now, includeInactiveChildren = false, idPrefix, onOpen }: {
  items: RowItem[];
  groups: ThreadRowGroup[];
  channel: (id: string) => { name: string; icon: string | null } | undefined;
  now: number;
  includeInactiveChildren?: boolean;
  idPrefix: string;
  onOpen: (item: RowItem) => void;
}) {
  const byID = new Map(items.map((item) => [item.id, item]));
  const visibleGroups = groups.filter((group) => byID.has(group.thread.id) || group.children.some((child) => byID.has(child.id)));
  const parentIDs = new Set(visibleGroups.map((group) => group.thread.id));
  const childIDs = new Set(visibleGroups.flatMap((group) => group.children.map((child) => child.id)));
  const ordinary = items.filter((item) => !parentIDs.has(item.id) && !childIDs.has(item.id));
  return (
    <div className="flex flex-col">
      {visibleGroups.map((group, i) => {
        const item = byID.get(group.thread.id) ?? rowOf(group.thread, channel(group.thread.channel_id), now);
        const children = includeInactiveChildren ? group.children : group.children.filter((child) => byID.has(child.id));
        if (!children.length) return <MoRows key={group.thread.id} items={[item]} onOpen={onOpen} />;
        return <MobileHandoffGroup
          key={group.thread.id}
          item={item}
          group={{ parent: group.thread, children }}
          onOpen={onOpen}
          last={i === visibleGroups.length - 1 && ordinary.length === 0}
          idPrefix={idPrefix}
        />;
      })}
      {ordinary.length > 0 && <MoRows items={ordinary} onOpen={onOpen} />}
    </div>
  );
}
