import { Fragment, useRef, type ReactNode } from 'react';
import { taskHost, type ChannelWithRunning, type ThreadStub } from '../api.ts';
import { DEFAULT_FOLDER_NAME, draftKey, freeName, useFolders } from '../folders.tsx';
import { pinnedRows } from '../pins.ts';
import { runningThreadGroups } from '../sidebar-lists.ts';
import { href, useHash, useRoute } from '../router.ts';
import { useApp } from '../store.tsx';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import { OmniMark } from './brand.tsx';
import { ChannelMark, ErrorNote, Thumb, useSlidingThumb } from './ui.tsx';
import { useUngroupDrop } from './sidebar/channel-lists.ts';
import { SidebarTop } from './sidebar/SidebarTop.tsx';
import { channelFolders, channelThreads, useChannelFold } from './sidebar/channel-lists.ts';
import { ThreadHandoffs } from './ThreadHandoffs.tsx';
import { FolderNameField, FolderRow, AddFolderButton } from './sidebar/FolderRows.tsx';
import { ChannelThreadEntry, NavLink, RunningBadge, SectionLink, ThreadLink, ThreadSection, useSectionFold } from './sidebar/SidebarRows.tsx';
import { ChannelListLink, WorkspaceLinks } from './sidebar/SidebarLinks.tsx';
import { UsageCard } from './sidebar/UsageCard.tsx';

/** Past this many threads a channel shows "N more" (or "See all threads" when highlighted) and links to its full list. */
const MAX_THREADS = 5;

const GROUPS: { kind: string; label: string }[] = [
  { kind: 'client', label: 'Clients' },
  { kind: 'internal', label: 'Internal' },
  { kind: 'personal', label: 'Personal' },
];

// onClose is the mobile drawer's: its X sits in the header beside collapse-all, both at a 44px touch size.
export function Sidebar({ onNavigate, onSearch, onClose }: { onNavigate?: () => void; onSearch: () => void; onClose?: () => void }) {
  const route = useRoute();
  const hash = useHash();
  const { channels, channelsError, openThread, tasks, pinned } = useApp();
  const folders = useFolders();
  const listRef = useRef<HTMLDivElement>(null);
  const { dropOn, ungroupDrop } = useUngroupDrop(folders);
  const { collapsed, setChannelOpen, foldAll, toggleAll } = useChannelFold(channels, folders);

  // Running and Pinned each fold on their own.
  const [runningClosed, toggleRunning] = useSectionFold('sidebar.runningCollapsed');
  const [pinsClosed, togglePins] = useSectionFold('sidebar.pinnedCollapsed');

  const activeChannel = route.name === 'channel' ? route.id : null;
  const openId = route.name === 'thread' ? route.id : null;
  const conductor = channels.find((c) => c.id === 'conductor');
  const rest = channels.filter((c) => c.id !== 'conductor');
  const other = rest.filter((c) => !GROUPS.some((g) => g.kind === c.kind));

  // The highlighted channel: the one open, or the one the open thread belongs to.
  const focused = activeChannel ?? (openThread && openThread.id === openId ? openThread.channel_id : null);

  const openIn = (c: ChannelWithRunning) => (openThread && openThread.id === openId && openThread.channel_id === c.id ? openThread : null);

  // Running and queued threads, newest first. The open thread joins them with the page's fresher
  // copy and stays after it stops, so the highlight never jumps out from under you. The highlighted
  // channel also lists its latest threads of any status, so finished ones stay a click away.
  // Threads in a folder are listed under the folder instead.
  const threadsOf = (c: ChannelWithRunning) => channelThreads(c, openIn(c), focused);
  /** The channel's folders, with the open thread under its own even past the listed ones. */
  const foldersOf = (c: ChannelWithRunning) => channelFolders(c, openIn(c));
  // Rows appearing or leaving above the highlighted one move it, so they re-measure the thumb too.
  const openCopy = openThread && openThread.id === openId ? openThread : null;
  const runningGroups = runningThreadGroups(channels, openCopy);
  const running = runningGroups.map((g) => g.thread);
  const pins = pinnedRows(pinned, openCopy);
  const sectionKey = (closed: boolean, list: ThreadStub[]) => (closed ? 'closed' : list.map((t) => t.id).join());
  const sectionsKey = [sectionKey(runningClosed, running), sectionKey(pinsClosed, pins)].join('|');
  const rowsKey = channels
    .flatMap((c) =>
      collapsed.has(c.id)
        ? [`${c.id}:closed`]
        : [...foldersOf(c).flatMap((f) => [f.id, f.collapsed, ...f.threads.map((t) => t.id)]), ...threadsOf(c).map((t) => t.id)],
    )
    .join();
  // Agent rows nest under threads, so they move the rows below them too.
  const agentsKey = tasks.map((k) => k.task_id).join();
  const box = useSlidingThumb(listRef, `${hash}:${channels.length}:${sectionsKey}:${rowsKey}:${agentsKey}:${folders.editing}`, true, '[data-active="true"]');

  const threadLinks = (c: ChannelWithRunning) => {
    const closed = collapsed.has(c.id);
    const open = openIn(c);
    const agents = (id: string) => tasks.filter((k) => taskHost(k) === id);
    // Closed, the rows stay mounted and fold to nothing, so opening and closing slide like the rest of the rail.
    // The open thread stays out under the name, so the highlight never vanishes into the fold.
    return (
      <>
        <div
          inert={closed}
          aria-hidden={closed || undefined}
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-(--ease-out) motion-reduce:transition-none ${
            closed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
          }`}
        >
          <div className="min-h-0 space-y-px overflow-hidden">{channelContents(c, closed)}</div>
        </div>
        {closed && open && <ThreadLink t={open} active tasks={agents(open.id)} onNavigate={onNavigate} />}
      </>
    );
  };

  /** A channel's folders, its new folder's name field and its threads. Closed, without the open thread, which shows outside. */
  const channelContents = (c: ChannelWithRunning, closed: boolean) => {
    const oid = closed ? null : openId;
    const list = threadsOf(c).filter((t) => !closed || t.id !== openId);
    const agents = (id: string) => tasks.filter((k) => taskHost(k) === id);
    const shown = list.filter((t, i) => i < MAX_THREADS || t.id === oid || agents(t.id).length > 0);
    return (
      <>
        {(closed ? (c.folders ?? []) : foldersOf(c)).map((f) => (
          <FolderRow key={f.id} f={f} openId={oid} tasks={tasks} handoffs={c.handoffs} onNavigate={onNavigate} />
        ))}
        {folders.editing === draftKey(c.id) && (
          <FolderNameField
            initial={freeName(c.folders ?? [], DEFAULT_FOLDER_NAME)}
            onSave={(name) => (folders.setEditing(null), void folders.create(c.id, name))}
            onCancel={() => folders.setEditing(null)}
          />
        )}
        {shown.map((t) => (
          <ChannelThreadEntry key={t.id} t={t} active={t.id === oid} tasks={agents(t.id)} handoffs={c.handoffs} onNavigate={onNavigate} />
        ))}
        {c.id === focused ? (
          <ChannelListLink channelId={c.id} onNavigate={onNavigate}>
            See all threads
          </ChannelListLink>
        ) : (
          list.length > shown.length && (
            <ChannelListLink channelId={c.id} onNavigate={onNavigate}>
              {list.length - shown.length} more
            </ChannelListLink>
          )
        )}
      </>
    );
  };

  const channelRow = (c: ChannelWithRunning, label: ReactNode, lead: ReactNode) => (
    <div
      className={`group/ch flex items-center rounded-full ${dropOn === c.id ? 'bg-wash shadow-[inset_0_0_0_1px_var(--line-strong)]' : ''}`}
      title={dropOn === c.id ? 'Drop to take it out of its folder' : undefined}
      {...ungroupDrop(c)}
    >
      <div className="min-w-0 flex-1">
        <NavLink
          to={href.channel(c.id)}
          channelId={c.id}
          active={activeChannel === c.id}
          expanded={!collapsed.has(c.id)}
          onNavigate={(e) => {
            // Clicking the channel already open on its threads closes or opens what is under it; any other click goes there, opened.
            if (route.name === 'channel' && route.id === c.id && route.tab === 'threads') {
              e.preventDefault();
              setChannelOpen(c.id, collapsed.has(c.id));
              return;
            }
            setChannelOpen(c.id, true);
            onNavigate?.();
          }}
          right={
            <span className="mr-6 flex items-center md:mr-0 md:group-focus-within/ch:mr-6 md:group-hover/ch:mr-6">
              <RunningBadge n={c.running} />
            </span>
          }
          lead={lead}
        >
          {label}
        </NavLink>
      </div>
      <AddFolderButton c={c} onOpen={() => setChannelOpen(c.id, true)} />
    </div>
  );

  const sectionLink = (t: ThreadStub, unpin = false) => (
    <SectionLink
      key={t.id}
      t={t}
      channel={t.channel_id === 'conductor' ? 'Conductor' : (channels.find((c) => c.id === t.channel_id)?.name ?? t.channel_id)}
      active={t.id === openId}
      agents={tasks.filter((k) => taskHost(k) === t.id).length}
      unpin={unpin}
      onNavigate={onNavigate}
    />
  );

  const sectionGroup = (group: { thread: ThreadStub; children: ThreadStub[] }, idPrefix: string) =>
    group.children.length ? (
      <ThreadHandoffs key={group.thread.id} idPrefix={idPrefix} parent={group.thread} children={group.children} renderParent={sectionLink(group.thread)} onNavigate={onNavigate} />
    ) : sectionLink(group.thread);

  const channelLink = (c: ChannelWithRunning) => (
    <Fragment key={c.id}>
      {channelRow(
        c,
        c.name,
        parseChannelIcon(c.icon) ? (
          <span className={`grid w-[15px] place-items-center ${activeChannel === c.id ? 'text-fg-2' : 'text-fg-3'}`}>
            <ChannelMark icon={c.icon} size={14} />
          </span>
        ) : (
          <span className={`w-[15px] text-center font-num text-[12px] ${activeChannel === c.id ? 'text-fg-2' : 'text-fg-4'}`}>#</span>
        ),
      )}
      {threadLinks(c)}
    </Fragment>
  );


  return (
    <nav className="flex h-full flex-col bg-sidebar" aria-label="Main">
      <SidebarTop channelCount={channels.length} foldAll={foldAll} onToggleAll={toggleAll} onNavigate={onNavigate} onSearch={onSearch} onClose={onClose} />

      <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div ref={listRef} className="relative space-y-4">
          <Thumb box={box} />
          <div className="space-y-px">
            <NavLink to={href.home()} icon="home" active={route.name === 'home'} onNavigate={onNavigate}>
              Home
            </NavLink>
            {conductor && (
              <>
                {channelRow(conductor, 'Conductor', <span className="grid w-[15px] place-items-center"><OmniMark size={17} /></span>)}
                {threadLinks(conductor)}
              </>
            )}
          </div>

          {running.length > 0 && (
            <ThreadSection label="Running" closed={runningClosed} onToggle={toggleRunning} count={runningGroups.reduce((n, g) => n + 1 + g.children.length, 0)}>
              {runningGroups.map((group) => sectionGroup(group, 'running'))}
            </ThreadSection>
          )}

          {pins.length > 0 && (
            <ThreadSection label="Pinned" closed={pinsClosed} onToggle={togglePins} count={pins.length}>
              {pins.map((t) => sectionLink(t, true))}
            </ThreadSection>
          )}

          {channelsError && <ErrorNote>{channelsError}</ErrorNote>}

          {GROUPS.map((g) => {
            const list = rest.filter((c) => c.kind === g.kind);
            if (!list.length) return null;
            return (
              <div key={g.kind}>
                <div className="caption px-3 pt-1 pb-2">{g.label}</div>
                <div className="space-y-px">{list.map(channelLink)}</div>
              </div>
            );
          })}
          {other.length > 0 && <div className="space-y-px">{other.map(channelLink)}</div>}

          <NavLink to={href.newChannel()} icon="plus" active={route.name === 'new-channel'} onNavigate={onNavigate}>
            Add channel
          </NavLink>

          <WorkspaceLinks onNavigate={onNavigate} />
        </div>
      </div>

      {/* The machine's name moved to Settings, Machines (#405). */}
      <div className="px-3 pt-1 pb-3">
        <UsageCard />
      </div>
    </nav>
  );
}
