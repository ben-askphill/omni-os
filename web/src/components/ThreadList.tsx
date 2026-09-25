import { useCallback, type CSSProperties, type ReactNode } from 'react';
import { useApi, type Thread } from '../api.ts';
import { groupByDay, relTime } from '../format.ts';
import { href } from '../router.ts';
import { useFeed, useNow } from '../store.tsx';
import { Avatar, Chip, Empty, ErrorNote, Loading, StatusDot } from './ui.tsx';

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
  const preview = t.last_text ? t.last_text.replace(/\s+/g, ' ').slice(0, 240) : t.status === 'running' ? 'Working' : t.status === 'queued' ? 'Waiting for a slot' : '';
  return (
    <a href={href.thread(t.id)} className="hov group flex items-start gap-3 rounded-[18px] px-3 py-3 [--hov:var(--surface)] md:px-3.5">
      {showChannel ? (
        <span className="relative mt-0.5 shrink-0">
          <Avatar name={t.channel_id} icon={t.channel_id === 'conductor' ? 'target' : undefined} size={32} />
          <span className="absolute -right-0.5 -bottom-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-bg">
            <StatusDot status={t.status} size={8} />
          </span>
        </span>
      ) : (
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface transition-colors group-hover:bg-bg">
          <StatusDot status={t.status} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[14px] font-medium text-fg">{t.title || 'Untitled'}</span>
          {t.role && <Chip>{t.role}</Chip>}
          {source && <Chip tone="outline">{source}</Chip>}
          <span className="ml-auto shrink-0 pl-2 font-num text-[11px] text-fg-4 tabular-nums">{relTime(t.updated_at)}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-3">
          {showChannel && <span className="shrink-0 text-fg-2">#{t.channel_id}</span>}
          {t.branch && <span className="hidden shrink-0 rounded-full bg-surface-2 px-1.5 font-mono text-[10.5px] leading-[18px] text-fg-3 sm:inline">{t.branch}</span>}
          <span className={`min-w-0 truncate ${!t.last_text && t.status === 'running' ? 'shimmer' : ''}`}>{preview}</span>
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
    <div className="space-y-4">
      {groupByDay(threads, (t) => t.updated_at).map((g) => (
        <section key={g.label}>
          <h3 className="label-mono sticky top-0 z-[2] flex items-center gap-2 bg-bg/90 px-3.5 py-2 backdrop-blur-md">
            {g.label}
            <span className="text-fg-4/70">{g.items.length}</span>
          </h3>
          <div className="rise">
            {g.items.map((t, i) => (
              <div key={t.id} style={{ '--i': Math.min(i, 12) } as CSSProperties}>
                <ThreadRow t={t} showChannel={showChannel} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
