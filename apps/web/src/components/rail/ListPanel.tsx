import { useEffect, useRef, useState, type ReactNode } from 'react';
import { taskHost } from '../../api.ts';
import { href, startNewThread, useRoute } from '../../router.ts';
import { useApp } from '../../store.tsx';
import type { ListMode } from '../../rail-model.ts';
import { DEFAULT_FOLDER_NAME, draftKey, freeName, useFolders } from '../../folders.tsx';
import { Icon, IconButton, Kbd } from '../ui.tsx';
import { channelFolders, channelThreads } from '../sidebar/channel-lists.ts';
import { FolderNameField, FolderRow } from '../sidebar/FolderRows.tsx';
import { InboxView } from '../sidebar/InboxView.tsx';
import { ChannelThreadEntry, NavLink } from '../sidebar/SidebarRows.tsx';
import { UsageCard } from '../sidebar/UsageCard.tsx';
import { useScrollFade } from './useScrollFade.ts';
import { setListCollapsed, useListCollapsed } from '../../layout-pref.ts';
import { useTooltip } from '../ui/tooltip.tsx';
import { RowCard } from './RowCard.tsx';
import { SettingsNav } from '../SettingsNav.tsx';
import { sectionShows } from '@omni/shared/settings-catalog.ts';
import { desktop } from '../../desktop.ts';
import { UpdateNotice } from '../UpdateNotice.tsx';
import { DiskNotice } from '../DiskNotice.tsx';
import { AccountNotice } from '../AccountNotice.tsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const TOGGLE_KEYS = isMac ? 'Meta+Backslash' : 'Control+Backslash';
const TOGGLE_HINT = isMac ? '⌘\\' : 'Ctrl+\\';
/** The scrolling list's id, which the toggle controls. */
const LIST_ID = 'rail-list-body';

/**
 * The list beside the rail, following the page: the selected channel's threads and folders, the Inbox with Search
 * and New thread above it, or Settings' sections. 264px of surface, or the 48px Collapsed list (a strip of marks and
 * avatars; the toggle in its header or ⌘\ switches, layout-pref.ts). Pages with no list (Overview, Pull requests,
 * Library, Automations, Search) get no panel.
 */
export function ListPanel({ mode, onSearch }: { mode: ListMode; onSearch: () => void }) {
  const collapsed = useListCollapsed();
  const folders = useFolders();
  const aside = useRef<HTMLElement>(null);
  /** Whether focus was inside the panel, kept past the element that held it going away. */
  const inside = useRef(false);
  useEffect(() => {
    const el = aside.current;
    if (!el) return;
    const onIn = () => (inside.current = true);
    const onOut = (e: FocusEvent) => {
      if (!(e.relatedTarget instanceof Node) || !el.contains(e.relatedTarget)) inside.current = false;
    };
    el.addEventListener('focusin', onIn);
    el.addEventListener('focusout', onOut);
    return () => {
      el.removeEventListener('focusin', onIn);
      el.removeEventListener('focusout', onOut);
    };
  }, [mode.kind]);
  // Collapsing cancels an open folder name field, and moves focus to the toggle when the control that held it hid.
  useEffect(() => {
    if (!collapsed) return;
    if (folders.editing) folders.setEditing(null);
    const active = document.activeElement;
    if (inside.current && (!active || active === document.body)) aside.current?.querySelector<HTMLElement>('[data-list-toggle]')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the flip matters
  }, [collapsed]);
  if (mode.kind === 'none') return null;
  const label = mode.kind === 'channel' ? `${mode.id === 'conductor' ? 'Conductor' : mode.id} threads` : mode.kind === 'settings' ? 'Settings sections' : 'Inbox list';
  return (
    <aside ref={aside} aria-label={label} data-collapsed={collapsed || undefined} className="rail-list flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--line)] bg-surface">
      {mode.kind === 'channel' ? <ChannelList id={mode.id} collapsed={collapsed} /> : mode.kind === 'settings' ? <SettingsList collapsed={collapsed} /> : <InboxList onSearch={onSearch} collapsed={collapsed} />}
    </aside>
  );
}

/** Settings' sections, in the panel instead of a column of the page, so the rail never shows three columns of navigation. */
function SettingsList({ collapsed }: { collapsed: boolean }) {
  const route = useRoute();
  const section = route.name === 'settings' && route.section && sectionShows(route.section, desktop !== null) ? route.section : 'general';
  return (
    <>
      <PanelHeader title="Settings" collapsed={collapsed} />
      <PanelScroll collapsed={collapsed}>
        <SettingsNav section={section} compact collapsed={collapsed} />
      </PanelScroll>
    </>
  );
}

/** The collapse toggle: 28px, named for what it does next, and keyed by ⌘\ or Ctrl+\ (App.tsx). */
function ListToggle({ collapsed }: { collapsed: boolean }) {
  const tip = useTooltip(`${collapsed ? 'Expand list' : 'Collapse list'} (${TOGGLE_HINT})`, { side: 'right', describes: false });
  return (
    <>
      <IconButton
        {...tip.triggerProps}
        icon="sidebar"
        size={15}
        label={collapsed ? 'Expand list' : 'Collapse list'}
        title={undefined}
        aria-expanded={!collapsed}
        aria-controls={LIST_ID}
        aria-keyshortcuts={TOGGLE_KEYS}
        data-list-toggle
        className="!h-7 !w-7"
        onClick={() => setListCollapsed(!collapsed)}
      />
      {tip.tip}
    </>
  );
}

/**
 * The panel's title row, 62px either way. On macOS the desktop app drags its window by it (index.css:
 * .rail-panel-top). Collapsed, only the toggle stays, centred in the strip.
 */
function PanelHeader({ title, lead, right, collapsed }: { title: ReactNode; lead?: ReactNode; right?: ReactNode; collapsed: boolean }) {
  return (
    <div className={`rail-panel-top flex h-[62px] shrink-0 items-end gap-1 pb-1.5 ${collapsed ? 'justify-center px-0' : 'px-3'}`}>
      {!collapsed && lead}
      <h2 className={`line-clamp-2 min-w-0 flex-1 text-[15px] leading-[1.25] font-semibold tracking-[-0.01em] text-balance text-fg ${collapsed ? 'sr-only' : lead ? '' : 'pl-2.5'}`}>{title}</h2>
      {!collapsed && right}
      <ListToggle collapsed={collapsed} />
    </div>
  );
}

/** The panel's scrolling list, fading at an edge while rows hide past it, as the rail does. No bar while collapsed, so it never takes width from the strip. */
function PanelScroll({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  const ref = useScrollFade();
  return (
    <div id={LIST_ID} ref={ref} className={`rail-scroll scroll-fade min-h-0 flex-1 overflow-y-auto ${collapsed ? 'scroll-none' : 'scroll-thin'}`}>
      {children}
    </div>
  );
}

function SearchRow({ onSearch }: { onSearch: () => void }) {
  const tip = useTooltip(<RowCard title="Search or jump to" lines={[isMac ? '⌘K' : 'Ctrl K']} />, { side: 'right', variant: 'card', describes: false });
  return (
    <>
      <button {...tip.triggerProps} type="button" onClick={onSearch} aria-label="Search or jump to" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'} className="item crow w-full text-fg-3 hover:text-fg-2">
        <Icon name="search" size={14} />
        <span className="crow-x min-w-0 flex-1 text-left font-normal">Search or jump to</span>
        <Kbd className="crow-x bg-surface-2">{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
      </button>
      {tip.tip}
    </>
  );
}

function NewThreadRow() {
  const route = useRoute();
  const { openThread } = useApp();
  const tip = useTooltip(<RowCard title="New thread" />, { side: 'right', variant: 'card', describes: false });
  return (
    <>
      <button {...tip.triggerProps} type="button" onClick={() => startNewThread(route, openThread)} aria-label="New thread" className="item crow w-full text-fg">
        <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[5px] bg-fg text-on-ink">
          <Icon name="plus" size={10} strokeWidth={2.4} />
        </span>
        <span className="crow-x min-w-0 flex-1 text-left">New thread</span>
      </button>
      {tip.tip}
    </>
  );
}

/**
 * The panel's foot: the update, disk and account notices, and the usage card, expanded only. Collapsed, the notices
 * stay mounted but hidden, and any that is up shows as one alert row whose card holds its text; a click expands the
 * panel. The usage card hides: Overview shows usage.
 */
function PanelFoot({ collapsed }: { collapsed: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setText(collapsed ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '');
    read();
    const watch = new MutationObserver(read);
    watch.observe(el, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [collapsed]);
  const tip = useTooltip(<RowCard title="Needs a look" lines={[text]} />, { side: 'right', variant: 'card', describes: false });
  return (
    <div className={collapsed ? 'rail-scroll !pt-1 !pb-3' : 'px-3 pt-1 pb-3'}>
      <div ref={box} hidden={collapsed} inert={collapsed}>
        <UpdateNotice className="mb-2" />
        <DiskNotice className="mb-2" />
        <AccountNotice className="mb-2" />
      </div>
      {collapsed ? (
        text && (
          <>
            <button {...tip.triggerProps} type="button" onClick={() => setListCollapsed(false)} aria-label={`Expand list: ${text}`} className="item crow w-full text-needs">
              <Icon name="alert" size={14} />
            </button>
            {tip.tip}
          </>
        )
      ) : (
        <UsageCard />
      )}
    </div>
  );
}

/** The Inbox (its pinned rows, what waits on Ben, Working, Done and the Workspace links), under Search and New thread. */
function InboxList({ onSearch, collapsed }: { onSearch: () => void; collapsed: boolean }) {
  return (
    <>
      <PanelHeader title="Inbox" collapsed={collapsed} />
      <PanelScroll collapsed={collapsed}>
        <InboxView
          links={false}
          variant="row"
          collapsed={collapsed}
          head={
            <div className="space-y-px pb-2">
              <SearchRow onSearch={onSearch} />
              <NewThreadRow />
            </div>
          }
        />
      </PanelScroll>
      <PanelFoot collapsed={collapsed} />
    </>
  );
}

function ChannelList({ id, collapsed }: { id: string; collapsed: boolean }) {
  const route = useRoute();
  const { channel, openThread, tasks } = useApp();
  const folders = useFolders();
  const c = channel(id);
  const openId = route.name === 'thread' ? route.id : null;
  const open = c && openThread && openThread.id === openId && openThread.channel_id === c.id ? openThread : null;
  const threads = c ? channelThreads(c, open, c.id) : [];
  const folderList = c ? channelFolders(c, open) : [];
  if (!c) return <PanelHeader title={id === 'conductor' ? 'Conductor' : id} collapsed={collapsed} />;
  const name = c.id === 'conductor' ? 'Conductor' : c.name;
  const agents = (tid: string) => tasks.filter((k) => taskHost(k) === tid);
  const tab = route.name === 'channel' && route.id === c.id ? route.tab : null;

  return (
    <>
      <PanelHeader
        title={name}
        collapsed={collapsed}
        right={
          c.id !== 'conductor' && (
            <IconButton icon="folderPlus" label="New folder" size={15} className="!h-7 !w-7" onClick={() => folders.setEditing(draftKey(c.id))} />
          )
        }
      />
      <PanelScroll collapsed={collapsed}>
        <div className="space-y-px pb-2">
          <NewThreadRow />
        </div>
        <div className="space-y-2">
          {(folderList.length > 0 || (folders.editing === draftKey(c.id) && !collapsed)) && (
            <div>
              <Caption collapsed={collapsed}>Folders</Caption>
              <div className="space-y-px">
                {folderList.map((f) => (
                  <FolderRow key={f.id} f={f} openId={openId} tasks={tasks} size="compact" collapsed={collapsed} />
                ))}
                {folders.editing === draftKey(c.id) && !collapsed && (
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
            <Caption collapsed={collapsed}>Recent</Caption>
            <div className="space-y-px">
              {threads.length ? (
                <>
                  {threads.map((t) => <ChannelThreadEntry key={t.id} t={t} active={t.id === openId} tasks={agents(t.id)} flush size="compact" collapsed={collapsed} />)}
                  <NavLink to={href.channel(c.id)} active={tab === 'threads' && !openId} size="compact" collapsed={collapsed} icon="grid" name="See all threads">
                    See all threads
                  </NavLink>
                </>
              ) : (
                !collapsed && <div className="px-2.5 text-[12px] text-fg-3">No threads yet.</div>
              )}
            </div>
          </div>
        </div>
      </PanelScroll>
    </>
  );
}

/** A group's caption in the list: its name, or a short rule centred in the strip while collapsed. */
function Caption({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <div className="caption crow-cap" role={collapsed ? 'group' : undefined} aria-label={collapsed ? String(children) : undefined}>
      {collapsed ? <span aria-hidden className="block h-px w-4 bg-line-strong" /> : children}
    </div>
  );
}
