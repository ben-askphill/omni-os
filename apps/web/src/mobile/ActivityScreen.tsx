import { useMemo, useState } from 'react';
import { HARNESS_ROWS, harnessLabel, OmniMark } from '../components/brand.tsx';
import { useLiveThreads } from '../components/ThreadList.tsx';
import { Segmented } from '../components/ui.tsx';
import { UpdateNotice } from '../components/UpdateNotice.tsx';
import { plural, windowPct } from '../format.ts';
import { href } from '../router.ts';
import { recentThreadGroups, recentThreads, runningThreadGroups, type ThreadRowGroup } from '../sidebar-lists.ts';
import { useApp, useNow } from '../store.tsx';
import { activityOf } from './activity.ts';
import { rowOf, type RowItem } from './rows.ts';
import { MoDelegatedRow } from './DelegatedRow.tsx';
import { delegatedIds, delegatesByParent } from '@omni/shared/delegate-count.ts';
import { NeedsCardView } from './NeedsCard.tsx';
import { HeaderActions } from './HeaderActions.tsx';
import { MoEmpty, MoHeader, MoRows, MoScroll, MoSection, MoTitle } from './parts.tsx';
import { useShell } from './shell.tsx';

type Filter = 'all' | 'needs' | 'running' | 'done';
const acceptAll = () => true;
const count = (n: number) => <span className="text-[11px] text-fg-4 tabular-nums">{n}</span>;

/** Home on a phone: what needs Ben first, answerable in place, then what runs and what finished today. */
export function ActivityScreen() {
  const shell = useShell();
  const { needsYou, pinned, channels, channel, usage } = useApp();
  const recent = useLiveThreads('/recent?limit=60', acceptAll, 60);
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>('all');
  const delegated = useMemo(() => delegatedIds(channels.find((c) => c.id === 'conductor')?.handoffs), [channels]);
  // Recent threads leaves delegated threads out before taking the latest five, so it still lists five rows.
  const undelegated = useMemo(() => channels.map((c) => ({ ...c, recent: c.recent?.filter((t) => !delegated.has(t.id)) })), [channels, delegated]);
  const a = useMemo(
    () => activityOf({ recent: recent.data, needsYou, pinned, latest: recentThreads(undelegated), channel: (id) => channel(id), harness: harnessLabel, now }),
    [recent.data, needsYou, pinned, undelegated, channel, now],
  );
  const runningGroups = useMemo(() => runningThreadGroups(channels), [channels]);
  const latestGroups = useMemo(() => recentThreadGroups(channels), [channels]);
  const runningCount = countThreadRows(a.running, runningGroups, delegated);
  const latestCount = countThreadRows(a.latest, latestGroups, delegated);
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
        right={<HeaderActions />}
      />
      <MoScroll tabBar>
        <div>
          <MoTitle title="Activity" sub={`${date} · ${a.running.length} running · ${a.needs.length} ${a.needs.length === 1 ? 'needs' : 'need'} you`} />
          <UsageMeters usage={usage} />
          <UpdateNotice className="mx-4 mb-3" />
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
            {a.running.length ? <ActivityThreadRows items={a.running} groups={runningGroups} channel={channel} now={now} onOpen={(r) => open(r.id)} /> : <MoEmpty>Nothing is running. Tap + to start something.</MoEmpty>}
          </MoSection>
        )}
        {filter === 'all' && a.pinned.length > 0 && (
          <MoSection title="Pinned" count={a.pinned.length}>
            <MoRows items={a.pinned} onOpen={(r) => open(r.id)} />
          </MoSection>
        )}
        {filter === 'all' && a.latest.length > 0 && (
          <MoSection title="Recent threads" count={latestCount}>
            <ActivityThreadRows items={a.latest} groups={latestGroups} channel={channel} now={now} onOpen={(r) => open(r.id)} />
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

/** Each plan's fullest window, as the sidebar's usage card shows on the desktop. Hidden until a harness reports one. */
function UsageMeters({ usage }: { usage: ReturnType<typeof useApp>['usage'] }) {
  const meters = HARNESS_ROWS.map((r) => {
    const u = usage[r.id];
    const five = windowPct(u?.five_hour);
    return { id: r.id, name: r.name, pct: five ?? windowPct(u?.monthly), unit: five === null ? 'mo' : '5h' };
  }).filter((m) => m.pct !== null);
  if (!meters.length) return null;
  return (
    <div className="mb-3.5 flex flex-wrap gap-2 px-4" aria-label="Plan usage">
      {meters.map((m) => (
        <span key={m.id} className="inline-flex items-center gap-2 rounded-full bg-surface py-1.5 pr-3 pl-3 text-[12px] tabular-nums">
          <span>{m.name}</span>
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-3">
            <span className={`block h-full rounded-full ${m.pct! > 0.9 ? 'bg-warn' : 'bg-fg'}`} style={{ width: `${m.pct! * 100}%` }} />
          </span>
          <span className="text-fg-3">
            {Math.round(m.pct! * 100)}% <span className="text-fg-4">{m.unit}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * The rows a list shows: each Conductor thread once, with its delegate count in place of the threads it delegated, which
 * get no row of their own. A Conductor thread whose delegated threads run joins Running even after its own turn ended.
 */
function threadRows(items: RowItem[], groups: ThreadRowGroup[], delegated: Set<string>) {
  const ids = new Set(items.map((item) => item.id));
  const parents = groups.filter((group) => ids.has(group.thread.id) || group.children.some((child) => ids.has(child.id))).map((g) => g.thread);
  const parentIds = new Set(parents.map((t) => t.id));
  return { parents, ordinary: items.filter((item) => !parentIds.has(item.id) && !delegated.has(item.id)) };
}

function countThreadRows(items: RowItem[], groups: ThreadRowGroup[], delegated: Set<string>) {
  const { parents, ordinary } = threadRows(items, groups, delegated);
  return parents.length + ordinary.length;
}

function ActivityThreadRows({ items, groups, channel, now, onOpen }: {
  items: RowItem[];
  groups: ThreadRowGroup[];
  channel: (id: string) => { name: string; icon: string | null } | undefined;
  now: number;
  onOpen: (item: RowItem) => void;
}) {
  const { channels } = useApp();
  const handoffs = channels.find((c) => c.id === 'conductor')?.handoffs;
  const delegates = delegatesByParent(handoffs);
  const { parents, ordinary } = threadRows(items, groups, delegatedIds(handoffs));
  const byID = new Map(items.map((item) => [item.id, item]));
  const rows = [...parents.map((t) => byID.get(t.id) ?? rowOf(t, channel(t.channel_id), now)), ...ordinary];
  return (
    <div className="flex flex-col">
      {rows.map((item, i) => (
        <MoDelegatedRow key={item.id} it={item} delegated={delegates.get(item.id)} last={i === rows.length - 1} onOpen={() => onOpen(item)} />
      ))}
    </div>
  );
}
