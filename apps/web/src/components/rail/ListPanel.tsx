import { useRef, type ReactNode } from 'react';
import { delegatesByParent } from '@omni/shared/delegate-count.ts';
import { taskHost, type ThreadStub } from '../../api.ts';
import { pinnedRows } from '../../pins.ts';
import { runningThreadGroups } from '../../sidebar-lists.ts';
import { href, startNewThread, useHash, useRoute } from '../../router.ts';
import { useApp } from '../../store.tsx';
import type { ListMode } from '../../rail-model.ts';
import { DEFAULT_FOLDER_NAME, draftKey, freeName, useFolders } from '../../folders.tsx';
import { Icon, IconButton, Kbd, Thumb, useSlidingThumb, type IconName } from '../ui.tsx';
import { channelFolders, channelThreads } from '../sidebar/channel-lists.ts';
import { FolderNameField, FolderRow } from '../sidebar/FolderRows.tsx';
import { InboxView } from '../sidebar/InboxView.tsx';
import { ChannelThreadEntry, NavLink, SectionLink, ThreadSection, useRowDelegates, useSectionFold } from '../sidebar/SidebarRows.tsx';
import { UsageCard } from '../sidebar/UsageCard.tsx';
import { UpdateNotice } from '../UpdateNotice.tsx';
import { DiskNotice } from '../DiskNotice.tsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The list beside the rail: Home's workspace list (Search, New thread, Inbox, Pull requests, Artifacts, Automations,
 * Running, Pinned), the Inbox, or the selected channel's threads and folders. 264px of surface.
 */
export function ListPanel({ mode, onSearch, onInbox }: { mode: ListMode; onSearch: () => void; onInbox: (open: boolean) => void }) {
  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-[var(--line)] bg-surface">
      {mode.kind === 'channel' ? (
        <ChannelList id={mode.id} />
      ) : mode.kind === 'inbox' ? (
        <>
          <PanelHeader title="Inbox" lead={<IconButton icon="chevronLeft" label="Back to Home" size={15} onClick={() => onInbox(false)} />} />
          <div className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <InboxView />
          </div>
        </>
      ) : (
        <HomeList onSearch={onSearch} onInbox={() => onInbox(true)} />
      )}
    </aside>
  );
}

/** The panel's title row. On macOS the desktop app drags its window by it (index.css: .rail-panel-top). */
function PanelHeader({ title, lead, right }: { title: ReactNode; lead?: ReactNode; right?: ReactNode }) {
  return (
    <div className="rail-panel-top flex h-[62px] shrink-0 items-end gap-1 px-3 pb-1.5">
      {lead}
      <h2 className={`min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-fg ${lead ? '' : 'pl-2.5'}`}>{title}</h2>
      {right}
    </div>
  );
}

function NewThreadButton() {
  const route = useRoute();
  const { openThread } = useApp();
  return (
    <button
      type="button"
      onClick={() => startNewThread(route, openThread)}
      className="press flex h-9 w-full items-center justify-center gap-2 rounded-full bg-fg text-[13px] font-medium text-on-ink transition-opacity hover:opacity-90"
    >
      <Icon name="plus" size={15} strokeWidth={2} /> New thread
    </button>
  );
}

function HomeList({ onSearch, onInbox }: { onSearch: () => void; onInbox: () => void }) {
  const route = useRoute();
  const hash = useHash();
  const { channels, openThread, tasks, pinned, needsYou } = useApp();
  const listRef = useRef<HTMLDivElement>(null);
  const [runningClosed, toggleRunning] = useSectionFold('sidebar.runningCollapsed');
  const [pinsClosed, togglePins] = useSectionFold('sidebar.pinnedCollapsed');
  const openId = route.name === 'thread' ? route.id : null;
  const openCopy = openThread && openThread.id === openId ? openThread : null;
  const running = runningThreadGroups(channels, openCopy).map((g) => g.thread);
  const pins = pinnedRows(pinned, openCopy);
  const delegates = delegatesByParent(channels.find((c) => c.id === 'conductor')?.handoffs);
  const nameOf = (t: ThreadStub) => (t.channel_id === 'conductor' ? 'Conductor' : (channels.find((c) => c.id === t.channel_id)?.name ?? t.channel_id));
  const inboxCount = needsYou?.items.length ?? 0;
  const box = useSlidingThumb(listRef, `${hash}:${running.map((t) => t.id).join()}:${runningClosed}:${pins.length}:${pinsClosed}`, true, '[data-active="true"]');
  const row = (t: ThreadStub, unpin = false) => (
    <SectionEntry
      key={t.id}
      t={t}
      channel={nameOf(t)}
      active={t.id === openId}
      home={!unpin}
      tasks={tasks.filter((k) => taskHost(k) === t.id)}
      unpin={unpin}
      delegated={unpin ? undefined : delegates.get(t.id)}
    />
  );

  return (
    <>
      <PanelHeader title="Home" />
      <div className="space-y-2 px-3 pt-2">
        <button
          type="button"
          onClick={onSearch}
          className="press flex h-9 w-full items-center gap-2.5 rounded-full bg-bg pr-2 pl-3.5 text-[13px] text-fg-3 shadow-[0_0_0_0.5px_var(--line)] transition-colors hover:text-fg-2"
        >
          <Icon name="search" size={15} />
          <span className="flex-1 text-left">Search or jump to</span>
          <Kbd className="bg-surface-2">{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
        </button>
        <NewThreadButton />
      </div>
      <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div ref={listRef} className="relative space-y-4">
          <Thumb box={box} />
          <div className="space-y-px">
            <PanelButton icon="inbox" label="Inbox" count={inboxCount} onClick={onInbox} />
            <NavLink to={href.pullRequests()} icon="pr" active={route.name === 'prs'}>Pull requests</NavLink>
            <NavLink to={href.artifacts()} icon="layers" active={route.name === 'artifacts'}>Artifacts</NavLink>
            <NavLink to={href.automations()} icon="clock" active={route.name === 'automations'}>Automations</NavLink>
          </div>
          {running.length > 0 && (
            <ThreadSection label="Running" closed={runningClosed} onToggle={toggleRunning} count={running.length}>
              {running.map((t) => row(t))}
            </ThreadSection>
          )}
          <ThreadSection label="Pinned" closed={pinsClosed} onToggle={togglePins} count={pins.length}>
            {pins.length ? pins.map((t) => row(t, true)) : <div className="px-3 pb-1 text-[12px] text-fg-4">Pin a thread from its menu to keep it here.</div>}
          </ThreadSection>
        </div>
      </div>
      <div className="px-3 pt-1 pb-3">
        <UpdateNotice className="mb-2" />
        <DiskNotice className="mb-2" />
        <UsageCard />
      </div>
    </>
  );
}

/** A Home row that opens a view in the panel itself (the Inbox) rather than a page. */
function PanelButton({ icon, label, count, onClick }: { icon: IconName; label: string; count?: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hov z-[1] flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-left text-[13px] text-fg-2 transition-colors hover:text-fg">
      <Icon name={icon} size={15} className="text-fg-3" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!!count && <span className="font-num text-[11px] text-fg-3 tabular-nums">{count}</span>}
    </button>
  );
}

function ChannelList({ id }: { id: string }) {
  const route = useRoute();
  const hash = useHash();
  const { channel, openThread, tasks } = useApp();
  const folders = useFolders();
  const listRef = useRef<HTMLDivElement>(null);
  const c = channel(id);
  const openId = route.name === 'thread' ? route.id : null;
  const open = c && openThread && openThread.id === openId && openThread.channel_id === c.id ? openThread : null;
  const threads = c ? channelThreads(c, open, c.id) : [];
  const folderList = c ? channelFolders(c, open) : [];
  const box = useSlidingThumb(
    listRef,
    `${hash}:${threads.map((t) => t.id).join()}:${folderList.map((f) => [f.id, f.collapsed, ...f.threads.map((t) => t.id)].join()).join('|')}:${folders.editing}`,
    true,
    '[data-active="true"]',
  );
  if (!c) return <PanelHeader title={id === 'conductor' ? 'Conductor' : id} />;
  const name = c.id === 'conductor' ? 'Conductor' : c.name;
  const agents = (tid: string) => tasks.filter((k) => taskHost(k) === tid);
  const tab = route.name === 'channel' && route.id === c.id ? route.tab : null;

  return (
    <>
      <PanelHeader
        title={name}
        right={
          c.id !== 'conductor' && (
            <IconButton icon="folderPlus" label="New folder" size={15} onClick={() => folders.setEditing(draftKey(c.id))} />
          )
        }
      />
      <div className="px-3 pt-2">
        <NewThreadButton />
      </div>
      <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div ref={listRef} className="relative space-y-4">
          <Thumb box={box} />
          {(folderList.length > 0 || folders.editing === draftKey(c.id)) && (
            <div>
              <div className="caption px-3 pt-1 pb-2">Folders</div>
              <div className="space-y-px">
                {folderList.map((f) => (
                  <FolderRow key={f.id} f={f} openId={openId} tasks={tasks} handoffs={c.handoffs} />
                ))}
                {folders.editing === draftKey(c.id) && (
                  <FolderNameField
                    initial={freeName(c.folders ?? [], DEFAULT_FOLDER_NAME)}
                    onSave={(n) => (folders.setEditing(null), void folders.create(c.id, n))}
                    onCancel={() => folders.setEditing(null)}
                  />
                )}
              </div>
            </div>
          )}
          <div>
            <div className="caption px-3 pt-1 pb-2">Recent</div>
            <div className="space-y-px">
              {threads.length ? (
                threads.map((t) => <ChannelThreadEntry key={t.id} t={t} active={t.id === openId} tasks={agents(t.id)} handoffs={c.handoffs} flush />)
              ) : (
                <div className="px-3 text-[12px] text-fg-4">No threads yet.</div>
              )}
              <NavLink to={href.channel(c.id)} active={tab === 'threads' && !openId}>
                <span className="text-fg-3">See all threads</span>
              </NavLink>
            </div>
          </div>
        </div>
      </div>
      {c.id !== 'conductor' && (
        <div className="border-t border-[var(--line)] px-3 pt-2 pb-3">
          <NavLink to={href.settings(c.id)} icon="sliders" active={tab === 'settings'}>
            Channel settings
          </NavLink>
        </div>
      )}
    </>
  );
}

/** A Running or Pinned row; a Conductor thread in Running carries its delegate count. */
function SectionEntry({ delegated, ...props }: Omit<Parameters<typeof SectionLink>[0], 'delegates'> & { delegated?: readonly ThreadStub[] }) {
  const delegates = useRowDelegates(props.t.id, delegated);
  return <SectionLink {...props} delegates={delegates} />;
}
