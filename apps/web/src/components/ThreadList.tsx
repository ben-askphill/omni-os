import { Loader } from './brand.tsx';
import { useCallback, useEffect, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { api, errorText, useApi, type BranchPRMark, type ChannelWithRunning, type FolderWithThreads, type Thread } from '../api.ts';
import { folderOf, groupByFolder } from '../folder-groups.ts';
import { drag, useFolders } from '../folders.tsx';
import { groupByDay, plural, relTime } from '../format.ts';
import { href } from '../router.ts';
import { useApp, useFeed, useNow } from '../store.tsx';
import { Avatar, Button, Chip, DoneMark, Empty, ErrorNote, Icon, Loading, StatusDot } from './ui.tsx';
import { ThreadHandoffs } from './ThreadHandoffs.tsx';

/** Loads a thread list and keeps it current from /feed. With `archived`, the list holds archived threads only. */
export function useLiveThreads(path: string, accept: (t: Thread) => boolean, limit = 500, archived = false) {
  const q = useApi<Thread[]>(path);
  const { setData, reload } = q;
  const acceptCb = useCallback(accept, [accept]);
  useFeed((e) => {
    if (e.type === 'reconnect') return reload();
    if (e.type !== 'thread' || !acceptCb(e.thread)) return;
    setData((prev) => {
      const list = (prev ?? []).filter((t) => t.id !== e.thread.id);
      // A thread archived or restored moves between the active list and the archived one.
      if (!!e.thread.archived === archived) list.push(e.thread);
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

/** Branch to PR for a channel's threads. Empty while loading, or when the channel has no repo. */
export function useThreadPRs(channelId: string): Record<string, BranchPRMark> {
  const q = useApi<Record<string, BranchPRMark>>(`/channels/${encodeURIComponent(channelId)}/thread-prs`);
  const { reload } = q;
  useEffect(() => {
    const tick = setInterval(() => document.visibilityState === 'visible' && reload(), 60_000);
    return () => clearInterval(tick);
  }, [reload]);
  return q.data ?? {};
}

/** A small PR icon: filled live when the PR is open, done when it merged. */
function PRMark({ pr }: { pr: BranchPRMark }) {
  const merged = pr.state === 'MERGED';
  const label = `PR #${pr.number} ${merged ? 'merged' : pr.isDraft ? 'draft' : 'open'}`;
  return (
    <span title={label} aria-label={label} role="img" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${merged ? 'bg-done text-on-done' : 'bg-live text-on-live'}`}>
      <Icon name="pr" size={12} strokeWidth={2.2} />
    </span>
  );
}

export function ThreadRow({ t, showChannel, pr }: { t: Thread; showChannel?: boolean; pr?: BranchPRMark }) {
  useNow(60_000);
  const { channels, mods } = useApp();
  const source = SOURCE_LABEL[t.source];
  // A mod's pinned status, compact beside the running indicator. The newest one when several mods set one.
  const mod = mods.findLast((m) => m.thread_id === t.id);
  const preview = t.last_text ? t.last_text.replace(/\s+/g, ' ').slice(0, 240) : t.status === 'running' ? 'Working' : t.status === 'queued' ? 'Waiting for a slot' : '';
  return (
    <a href={href.thread(t.id)} className="hov group flex min-w-0 items-start gap-3 rounded-[18px] px-3 py-3 [--hov:var(--surface)] md:px-3.5">
      {showChannel ? (
        <span className="relative mt-0.5 shrink-0">
          <Avatar name={t.channel_id} channelIcon={channels.find((c) => c.id === t.channel_id)?.icon} size={32} />
          <span className="absolute -right-0.5 -bottom-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-bg">
            {t.done_at ? <DoneMark size={8} /> : <StatusDot status={t.status} size={8} />}
          </span>
        </span>
      ) : (
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface transition-colors group-hover:bg-bg">
          {t.done_at ? <DoneMark /> : <StatusDot status={t.status} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`min-w-0 truncate text-[14px] group-hover:text-fg ${t.done_at ? 'text-fg-4' : 'text-fg-2'}`}>{t.title || 'Untitled'}</span>
          {t.done_at && <Chip tone="outline">Done</Chip>}
          {t.role && <Chip>{t.role}</Chip>}
          {source && <Chip tone="outline">{source}</Chip>}
          {pr && <PRMark pr={pr} />}
          <span className="ml-auto shrink-0 pl-2 font-num text-[11px] text-fg-4 tabular-nums">{relTime(t.updated_at)}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-fg-3">
          {showChannel && <span className="shrink-0 text-fg-2">#{t.channel_id}</span>}
          {t.branch && <span className="hidden shrink-0 rounded-full bg-surface-2 px-1.5 font-mono text-[10.5px] leading-[18px] text-fg-3 sm:inline">{t.branch}</span>}
          {!t.last_text && t.status === 'running' && <Loader size={11} className="shrink-0" />}
          {mod && (
            <span className="shrink-0 truncate rounded-full bg-surface-2 px-1.5 text-[11px] leading-[18px] text-fg-3 sm:max-w-[45%]" title={`${mod.plugin}: ${mod.text}`}>
              {mod.text}
            </span>
          )}
          <span className="min-w-0 truncate">{preview}</span>
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
  prs,
  empty,
  channel,
}: {
  threads: Thread[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  showChannel?: boolean;
  prs?: Record<string, BranchPRMark>;
  empty?: ReactNode;
  /** One channel's list: grouped by its sidebar folders when it has any. */
  channel?: ChannelWithRunning;
}) {
  const handoffs = channel?.id === 'conductor' ? channel.handoffs ?? [] : [];
  const childIds = new Set(handoffs.flatMap((g) => g.children.map((child) => child.id)));
  const visibleThreads = (threads ?? []).filter((t) => !childIds.has(t.id));
  if (error && !threads) return <ErrorNote onRetry={onRetry}>{error}</ErrorNote>;
  if (!threads && loading) return <Loading label="Loading threads" />;
  if (channel?.folders?.length) return <FolderGroups threads={visibleThreads} channel={channel} prs={prs} handoffs={handoffs} />;
  if (!visibleThreads.length) return <>{empty ?? <Empty icon="message" title="No threads yet" />}</>;
  return (
    <div className="space-y-4">
      {groupByDay(visibleThreads, (t) => t.updated_at).map((g) => (
        <section key={g.label}>
          <h3 className="caption sticky top-0 z-[2] flex items-center gap-2 bg-bg px-3.5 py-2">
            {g.label}
            <span className="text-fg-4/70">{g.items.length}</span>
          </h3>
          <Rows threads={g.items} showChannel={showChannel} prs={prs} handoffs={handoffs} />
        </section>
      ))}
    </div>
  );
}

function Rows({ threads, showChannel, prs, draggable, handoffs = [] }: {
  threads: Thread[]; showChannel?: boolean; prs?: Record<string, BranchPRMark>; draggable?: boolean;
  handoffs?: ChannelWithRunning['handoffs'];
}) {
  return (
    <div className="rise">
      {threads.map((t, i) => (
        <div
          key={t.id}
          style={{ '--i': Math.min(i, 12) } as CSSProperties}
          onDragStart={
            draggable
              ? (e) => {
                  drag.start({ kind: 'thread', thread: t });
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.title || 'Untitled');
                }
              : undefined
          }
          onDragEnd={draggable ? drag.end : undefined}
        >
          {handoffs.find((g) => g.parent.id === t.id)?.children.length ? (
            <ThreadHandoffs
              idPrefix="channel-content"
              parent={t}
              children={handoffs.find((g) => g.parent.id === t.id)!.children}
              renderParent={<ThreadRow t={t} showChannel={showChannel} pr={t.branch ? prs?.[t.branch] : undefined} />}
            />
          ) : (
            <ThreadRow t={t} showChannel={showChannel} pr={t.branch ? prs?.[t.branch] : undefined} />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A channel's threads under its sidebar folders, in the sidebar's order and with its open or closed state, then the
 * threads in none under "No folder". Drop a thread on a folder to file it there, or on "No folder" to take it out.
 */
function FolderGroups({ threads, channel, prs, handoffs = [] }: { threads: Thread[]; channel: ChannelWithRunning; prs?: Record<string, BranchPRMark>; handoffs?: ChannelWithRunning['handoffs'] }) {
  const { folders: groups, unfiled } = groupByFolder(threads, channel);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.folder.id}>
          <FolderHeader channel={channel} folder={g.folder} count={g.threads.length} running={g.threads.some((t) => t.status === 'running' || t.status === 'queued')} />
          {!g.folder.collapsed &&
            (g.threads.length ? (
              <Rows threads={g.threads} prs={prs} draggable handoffs={handoffs} />
            ) : (
              <div className="px-3.5 pb-1 text-[12.5px] leading-7 text-fg-4">No threads yet. Drag one here or use Move to folder.</div>
            ))}
        </section>
      ))}
      <section>
        <FolderHeader channel={channel} count={unfiled.length} running={false} />
        {unfiled.length ? (
          <Rows threads={unfiled} prs={prs} draggable handoffs={handoffs} />
        ) : (
          <div className="px-3.5 pb-1 text-[12.5px] leading-7 text-fg-4">Every thread is in a folder.</div>
        )}
      </section>
    </div>
  );
}

/** A folder's header: chevron, name and count, opening and closing it as its sidebar row does. Without a folder, "No folder". */
function FolderHeader({ channel, folder, count, running }: { channel: ChannelWithRunning; folder?: FolderWithThreads; count: number; running: boolean }) {
  const folders = useFolders();
  const [over, setOver] = useState(false);
  const target = folder?.id ?? null;
  const accepts = () => {
    const d = drag.get();
    return d?.kind === 'thread' && d.thread.channel_id === channel.id && !target?.startsWith('tmp-') && folderOf(channel, d.thread) !== target;
  };
  const onOver = (e: DragEvent) => {
    if (!accepts()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    const d = drag.get();
    setOver(false);
    if (d?.kind !== 'thread' || !accepts()) return;
    e.preventDefault();
    drag.end();
    void folders.moveThread({ ...d.thread, folder_id: folderOf(channel, d.thread) }, target);
  };
  const cls = `caption flex w-full items-center gap-2 rounded-full px-3.5 py-2 text-left transition-shadow ${
    over ? 'bg-wash shadow-[inset_0_0_0_1px_var(--line-strong)]' : ''
  }`;
  const label = `${folder?.name ?? 'No folder'}, ${plural(count, 'thread')}`;
  return (
    <h3 className="sticky top-0 z-[2] bg-bg" onDragOver={onOver} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {folder ? (
        <button type="button" data-folder-id={folder.id} onClick={() => void folders.toggle(folder.id)} aria-expanded={!folder.collapsed} aria-label={label} title={label} className={`hov ${cls} [--hov:var(--surface)]`}>
          <Icon name={folder.collapsed ? 'chevronRight' : 'chevronDown'} size={12} className="-ml-0.5 shrink-0 text-fg-4" />
          <Icon name="folder" size={13} className="shrink-0 text-fg-3" />
          <span className="min-w-0 truncate">{folder.name}</span>
          <span className="text-fg-4/70">{count}</span>
          {running && <Loader size={11} className="shrink-0 text-live-text" />}
        </button>
      ) : (
        <div aria-label={label} className={cls}>
          <span className="w-3 shrink-0" />
          No folder
          <span className="text-fg-4/70">{count}</span>
        </div>
      )}
    </h3>
  );
}

/**
 * A channel's archived threads, under its list: a closed "Archived" header with the count, opening to the threads
 * with Restore on each. Restoring puts the thread back in the list above, in its folder if it had one.
 */
export function ArchivedThreads({ channelId }: { channelId: string }) {
  const accept = useCallback((t: Thread) => t.channel_id === channelId && t.source !== 'team', [channelId]);
  const list = useLiveThreads(`/channels/${encodeURIComponent(channelId)}/threads?archived=1`, accept, 200, true);
  const [open, setOpen] = useState(false);
  const count = list.data?.length ?? 0;
  if (!count) return null;
  return (
    <section className="mt-6">
      <h3 className="sticky top-0 z-[2] bg-bg">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="hov caption flex w-full items-center gap-2 rounded-full px-3.5 py-2 text-left [--hov:var(--surface)]"
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="-ml-0.5 shrink-0 text-fg-4" />
          <Icon name="archive" size={13} className="shrink-0 text-fg-3" />
          Archived
          <span className="text-fg-4/70">{count}</span>
        </button>
      </h3>
      {open && (
        <div className="rise">
          {list.data!.map((t, i) => (
            <ArchivedRow key={t.id} t={t} i={i} />
          ))}
        </div>
      )}
    </section>
  );
}

function ArchivedRow({ t, i }: { t: Thread; i: number }) {
  const { reloadChannels } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The feed moves the row out of this list and into the active one.
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch<Thread>(`/threads/${encodeURIComponent(t.id)}`, { archived: false });
      await reloadChannels();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-1" style={{ '--i': Math.min(i, 12) } as CSSProperties}>
      <div className="min-w-0 flex-1 opacity-80">
        <ThreadRow t={t} />
      </div>
      <div className="flex shrink-0 flex-col items-end pr-1">
        <Button size="sm" icon="archive" busy={busy} onClick={restore} aria-label={`Restore ${t.title || 'Untitled'}`}>
          Restore
        </Button>
        {error && <span className="mt-1 max-w-[180px] truncate text-[11px] text-fg-3" title={error}>{error}</span>}
      </div>
    </div>
  );
}
