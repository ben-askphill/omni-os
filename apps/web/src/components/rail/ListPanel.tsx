import { useRef, type ReactNode } from 'react';
import { taskHost } from '../../api.ts';
import { href, startNewThread, useHash, useRoute } from '../../router.ts';
import { useApp } from '../../store.tsx';
import type { ListMode } from '../../rail-model.ts';
import { DEFAULT_FOLDER_NAME, draftKey, freeName, useFolders } from '../../folders.tsx';
import { Icon, IconButton, Kbd, Thumb, useSlidingThumb } from '../ui.tsx';
import { channelFolders, channelThreads } from '../sidebar/channel-lists.ts';
import { FolderNameField, FolderRow } from '../sidebar/FolderRows.tsx';
import { InboxView } from '../sidebar/InboxView.tsx';
import { ChannelThreadEntry, NavLink } from '../sidebar/SidebarRows.tsx';
import { UsageCard } from '../sidebar/UsageCard.tsx';
import { UpdateNotice } from '../UpdateNotice.tsx';
import { DiskNotice } from '../DiskNotice.tsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The list beside the rail: the selected channel's threads and folders, else the Inbox with Search and New thread
 * above it. 264px of surface.
 */
export function ListPanel({ mode, onSearch }: { mode: ListMode; onSearch: () => void }) {
  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-[var(--line)] bg-surface">
      {mode.kind === 'channel' ? <ChannelList id={mode.id} /> : <InboxList onSearch={onSearch} />}
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

/** The Inbox (its pinned cards, what waits on Ben, Working, Done and the Workspace links), under Search and New thread. */
function InboxList({ onSearch }: { onSearch: () => void }) {
  return (
    <>
      <PanelHeader title="Inbox" />
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
        <InboxView />
      </div>
      <div className="px-3 pt-1 pb-3">
        <UpdateNotice className="mb-2" />
        <DiskNotice className="mb-2" />
        <UsageCard />
      </div>
    </>
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
                <div className="px-3 text-[12px] text-fg-3">No threads yet.</div>
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
