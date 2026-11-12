import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { dayKey, isInsightRange, type InsightRange, type Insights } from '@omni/shared/insights.ts';
import { isWorking } from '@omni/shared/delegate-count.ts';
import { useApi, type Thread } from '../api.ts';
import { NewThreadComposer } from '../components/Composer.tsx';
import { EmptyNote, NeedsYouRow } from '../components/NeedsYou.tsx';
import { ThreadGroups, useLiveThreads } from '../components/ThreadList.tsx';
import { OmniWordmark } from '../components/brand.tsx';
import { AutomationsCard, BusiestCard, ChannelAvatar, KpiTiles, LIST_TITLE, NeedsYouCard, PRsCard, type ListKind } from '../components/dashboard/Cards.tsx';
import { UsageSection } from '../components/dashboard/UsageSection.tsx';
import { Segmented, StatusDot } from '../components/ui.tsx';
import { greeting } from '../greeting.ts';
import { splitNeeds } from '../needs-you.ts';
import { readPref, useApp, useFeed, writePref } from '../store.tsx';

const acceptAll = () => true;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LISTS: ListKind[] = ['needs', 'running', 'unread', 'done'];

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

/** The list a KPI tile opened, from `#/?list=`: a link Ben can share or go back to. */
function useOpenList(): ListKind | null {
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash,
  );
  const v = new URLSearchParams(hash.split('?')[1] ?? '').get('list');
  return (LISTS as string[]).includes(v ?? '') ? (v as ListKind) : null;
}

/** Re-asks while the server is still reading the logs or GitHub, so the partial numbers fill in without a reload. */
function useInsights(range: InsightRange) {
  const q = useApi<Insights>(`/insights?range=${range}&tz=${encodeURIComponent(TZ)}`);
  const partial = !!q.data && (!q.data.usage.complete || q.data.prs === null);
  const { reload } = q;
  useEffect(() => {
    if (!partial) return;
    const t = setTimeout(reload, 3000);
    return () => clearTimeout(t);
  }, [partial, q.data, reload]);
  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);
  // A thread started or marked done moves Done and Busiest channels: ask again once the burst settles.
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFeed((e) => {
    if (e.type !== 'thread') return;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(reload, 11_000);
  });
  useEffect(() => () => void (settle.current && clearTimeout(settle.current)), []);
  return q;
}

function OpenList({ kind, insights }: { kind: ListKind; insights: Insights | undefined }) {
  const { needsYou } = useApp();
  const recent = useLiveThreads('/recent?limit=200', acceptAll, 200);
  const { needs, unread } = splitNeeds(needsYou?.items ?? []);
  const meta = LIST_TITLE[kind];
  const doneInRange = (t: Thread) => {
    if (!t.done_at || !insights) return false;
    const day = dayKey(Date.parse(t.done_at), TZ);
    return day >= insights.from && day <= insights.to;
  };
  const items = kind === 'needs' ? needs : kind === 'unread' ? unread : null;
  return (
    <section aria-label={meta.title} className="mt-4">
      <div className="mb-1 flex items-center justify-between px-1">
        <h2 className="font-display text-[length:var(--fs-heading)]">{meta.title}</h2>
        <a href="#/" className="text-[12px] text-fg-3 hover:text-fg">
          Close
        </a>
      </div>
      {items ? (
        items.length ? (
          <div className="flex flex-col">
            {items.map((i) => (
              <NeedsYouRow key={i.thread.id} item={i} showChannel />
            ))}
          </div>
        ) : (
          <EmptyNote icon={meta.icon}>{meta.empty}</EmptyNote>
        )
      ) : (
        <ThreadGroups
          threads={recent.data?.filter(kind === 'running' ? isWorking : doneInRange)}
          loading={recent.loading}
          error={recent.error}
          onRetry={recent.reload}
          showChannel
          empty={<EmptyNote icon={meta.icon}>{meta.empty}</EmptyNote>}
        />
      )}
    </section>
  );
}

export function HomePage() {
  const { needsYou, profile } = useApp();
  const [range, setRangeState] = useState<InsightRange>(() => {
    const saved = readPref<string>('home.range', '30d');
    return isInsightRange(saved) ? saved : '30d';
  });
  const setRange = (r: InsightRange) => {
    writePref('home.range', r);
    setRangeState(r);
  };
  const [startIn, setStartIn] = useState<string | null>(null);
  const open = useOpenList();
  const insights = useInsights(range);
  const data = insights.data?.range === range ? insights.data : undefined;
  const split = needsYou ? splitNeeds(needsYou.items) : null;
  const chips = data?.channels.slice(0, 4) ?? [];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="@container mx-auto box-content max-w-[1120px] px-4 pt-8 pb-16 md:px-10 md:pt-14">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <OmniWordmark height={24} />
            <div className="caption mt-4 mb-2.5">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h1 className="font-display text-[length:var(--fs-title)] leading-[1.1] md:text-[length:var(--fs-title-lg)]">{greeting(new Date().getHours(), profile?.name ?? '')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              label="Range"
              value={range}
              onChange={setRange}
              options={[
                { id: 'today', label: 'Today' },
                { id: '7d', label: '7 days' },
                { id: '30d', label: '30 days' },
              ]}
            />
            <Pulse />
          </div>
        </header>

        <NewThreadComposer key={startIn ?? 'default'} defaultChannel={startIn ?? undefined} big />
        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
            <span className="caption">Start in</span>
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setStartIn(c.id)}
                aria-pressed={startIn === c.id}
                className={`press inline-flex h-7 items-center gap-1.5 rounded-full pr-3 pl-1 text-[12px] ${startIn === c.id ? 'bg-fg text-on-ink' : 'bg-surface text-fg-2 hover:text-fg'}`}
              >
                <ChannelAvatar id={c.id} name={c.name} icon={c.icon} size={20} />#{c.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-8">
          <KpiTiles needs={split?.needs ?? null} unread={split?.unread.length ?? null} done={data?.done ?? null} open={open} />
          {open && <OpenList kind={open} insights={data} />}
        </div>

        <div className="mt-8">
          <UsageSection usage={data?.usage} range={range} from={data?.from} to={data?.to} loading={insights.loading || !insights.error} />
        </div>

        <div className="mt-8 grid gap-4 @3xl:grid-cols-2">
          <NeedsYouCard needs={split?.needs ?? null} />
          <BusiestCard list={data?.channels} />
          <PRsCard prs={data ? data.prs : undefined} loading={!insights.error} />
          <AutomationsCard automations={data?.automations} />
        </div>
      </div>
    </div>
  );
}
