import { useCallback, type ReactNode } from 'react';
import { useApi, type Thread } from '../api.ts';
import { groupByDay, relTime } from '../format.ts';
import { href } from '../router.ts';
import { useFeed, useNow } from '../store.tsx';
import { Chip, Empty, ErrorNote, Loading, StatusDot } from './ui.tsx';

/** Loads a thread list and keeps it current from /feed. */
export function useLiveThreads(path: string, accept: (t: Thread) => boolean, limit = 500) {
  const q = useApi<Thread[]>(path);
  const { setData, reload } = q;
  const acceptCb = useCallback(accept, [accept]);
  useFeed((e) => {
    if (e.type === 'reconnect') return reload();
    if (e.type !== 'thread' || !acceptCb(e.thread)) return;
    setData((prev) => {
      const list = (prev ?? []).filter((t) => t.id !== e.thread.id);
      list.push(e.thread);
      list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
      return list.slice(0, limit);
    });
  });
  return q;
}

const SOURCE_LABEL: Record<string, string> = {
  automation: 'Automation',
  conductor: 'Conductor',
  import: 'Imported',
  capture: 'Capture',
};

export function ThreadRow({ t, showChannel }: { t: Thread; showChannel?: boolean }) {
  useNow(60_000);
  const source = SOURCE_LABEL[t.source];
  return (
    <a
      href={href.thread(t.id)}
      className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2 md:px-3"
    >
      <StatusDot status={t.status} className="mt-[6px]" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[14px] font-medium text-fg">{t.title || 'Untitled'}</span>
          {t.role && <Chip>{t.role}</Chip>}
          {source && <Chip tone="outline">{source}</Chip>}
          <span className="ml-auto shrink-0 pl-2 text-[12px] text-fg-3 tabular-nums">{relTime(t.updated_at)}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-3">
          {showChannel && <span className="shrink-0 font-medium text-fg-2">#{t.channel_id}</span>}
          {t.branch && <span className="hidden shrink-0 font-mono text-[11.5px] sm:inline">{t.branch}</span>}
          <span className="min-w-0 truncate">{t.last_text ? t.last_text.replace(/\s+/g, ' ').slice(0, 240) : t.status === 'running' ? 'Working' : t.status === 'queued' ? 'Waiting for a slot' : ''}</span>
        </div>
      </div>
    </a>
  );
}

export function ThreadGroups({
  threads,
  loading,
  error,
  onRetry,
  showChannel,
  empty,
}: {
  threads: Thread[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  showChannel?: boolean;
  empty?: ReactNode;
}) {
  if (error && !threads) return <ErrorNote onRetry={onRetry}>{error}</ErrorNote>;
  if (!threads && loading) return <Loading label="Loading threads" />;
  if (!threads?.length) return <>{empty ?? <Empty icon="message" title="No threads yet" />}</>;
  return (
    <div className="space-y-5">
      {groupByDay(threads, (t) => t.updated_at).map((g) => (
        <section key={g.label}>
          <h3 className="sticky top-0 z-[1] bg-bg/95 px-3 py-1.5 text-[11.5px] font-semibold tracking-wide text-fg-3 uppercase backdrop-blur">{g.label}</h3>
          <div className="space-y-px">
            {g.items.map((t) => (
              <ThreadRow key={t.id} t={t} showChannel={showChannel} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
