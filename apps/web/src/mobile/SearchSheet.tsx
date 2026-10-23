import { useEffect, useMemo, useState } from 'react';
import { useApi, type SearchHit, type Thread } from '../api.ts';
import { useLiveThreads } from '../components/ThreadList.tsx';
import { Avatar, Icon } from '../components/ui.tsx';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { MoEmpty, MoGroup, MoListRow, MoRows, MoSheet } from './parts.tsx';
import { rowOf, shortTime, type RowItem } from './rows.ts';
import { useShell } from './shell.tsx';

const notTeam = (t: Thread) => t.source !== 'team' && !t.archived;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Search from any tab: recent threads until Ben types, then matching channels and the server's full-text hits. */
export function SearchSheet() {
  const shell = useShell();
  const { channels, channel } = useApp();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 200);
  const recent = useLiveThreads('/recent?limit=30', notTeam, 30);
  const hits = useApi<SearchHit[]>(query ? `/search?q=${encodeURIComponent(query)}` : null);
  const now = useNow(60_000);
  const close = () => shell.sheet(null);

  const matched = useMemo(() => {
    const s = query.toLowerCase();
    return s ? channels.filter((c) => !c.archived && `${c.name} ${c.id}`.toLowerCase().includes(s)) : [];
  }, [channels, query]);
  const rows: RowItem[] = useMemo(() => {
    if (!query) return (recent.data ?? []).filter(notTeam).map((t) => rowOf(t, channel(t.channel_id), now));
    return (hits.data ?? []).map((h) => {
      const c = channel(h.channel_id);
      return {
        id: h.thread_id,
        title: h.title || 'Untitled',
        channel: c?.name ?? h.channel_id,
        channelId: h.channel_id,
        channelIcon: c?.icon ?? null,
        role: null,
        status: h.status,
        settled: h.status !== 'running' && h.status !== 'queued',
        time: shortTime(h.updated_at, now),
        meta: h.snippet.replace(/<\/?mark>/g, '') || null,
      };
    });
  }, [query, recent.data, hits.data, channel, now]);
  const empty = query
    ? hits.error ?? (hits.loading ? 'Searching' : matched.length ? null : `Nothing matches "${query}". Prefix matches work, so checko finds checkout.`)
    : recent.loading && !recent.data
      ? 'Loading'
      : 'No threads yet.';

  return (
    <MoSheet full onClose={close} label="Search">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1.5">
        <label className="flex h-11 flex-1 items-center gap-2 rounded-full bg-surface-2 px-3.5 text-fg-3">
          <Icon name="search" size={16} />
          <input
            autoFocus
            type="text"
            inputMode="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Threads and channels"
            aria-label="Search threads and channels"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-4"
          />
        </label>
        <button type="button" onClick={close} className="px-1.5 text-[15px] font-medium text-fg">
          Cancel
        </button>
      </div>
      <div className="mo-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-1.5">
        {matched.length > 0 && (
          <MoGroup>
            {matched.map((c, i) => (
              <MoListRow
                key={c.id}
                icon={<Avatar name={c.name} channelIcon={c.icon} icon={c.id === 'conductor' ? 'target' : undefined} size={28} />}
                label={c.id === 'conductor' ? 'Conductor' : `#${c.name}`}
                sub={c.store_domain || c.github_repo || undefined}
                onClick={() => shell.open(href.channel(c.id))}
                last={i === matched.length - 1}
              />
            ))}
          </MoGroup>
        )}
        {rows.length ? <MoRows items={rows} onOpen={(r) => shell.open(href.thread(r.id))} /> : empty && <MoEmpty>{empty}</MoEmpty>}
      </div>
    </MoSheet>
  );
}
