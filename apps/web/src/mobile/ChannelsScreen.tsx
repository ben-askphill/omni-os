import { useCallback, useMemo, useState } from 'react';
import type { ChannelWithRunning, ConductorHandoffGroup, Thread } from '../api.ts';
import { OmniMark } from '../components/brand.tsx';
import { useLiveThreads } from '../components/ThreadList.tsx';
import { Avatar, Icon, Segmented, StatusDot } from '../components/ui.tsx';
import { inChannel, reasonOf } from '../needs-you.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { useFolders } from '../folders.tsx';
import { delegatesByParent } from '@omni/shared/delegate-count.ts';
import { bottomInset, MoEmpty, MoGroup, MoHeader, MoListRow, MoRound, MoScroll, MoSection, MoTitle } from './parts.tsx';
import { MoDelegatedRow } from './DelegatedRow.tsx';
import { HeaderActions } from './HeaderActions.tsx';
import { rowOf, type RowItem } from './rows.ts';
import { useShell } from './shell.tsx';
import { isWorking } from '@omni/shared/delegate-count.ts';

const GROUPS: { label: string; kinds: string[] }[] = [
  { label: 'Clients', kinds: ['client'] },
  { label: 'Internal', kinds: ['internal', 'system'] },
  { label: 'Personal', kinds: ['personal'] },
];
const KIND_LABEL: Record<string, string> = { client: 'Client', internal: 'Internal', personal: 'Personal', system: 'System' };

function Counts({ needs, running }: { needs: number; running: number }) {
  return (
    <>
      {needs > 0 && (
        <span className="inline-flex items-center gap-[5px]">
          <StatusDot status="needs" size={8} />
          {needs}
        </span>
      )}
      {running > 0 && (
        <span className="inline-flex items-center gap-[5px]">
          <StatusDot status="running" size={8} />
          {running}
        </span>
      )}
    </>
  );
}

/** The Channels tab: the Conductor, then every channel by kind with what needs Ben and what runs in it. */
export function ChannelsScreen() {
  const shell = useShell();
  const { channels, needsYou, channel } = useApp();
  const listed = channels.filter((c) => !c.archived && c.id !== 'conductor');
  const conductor = channel('conductor');
  const running = channels.reduce((n, c) => n + (c.running || 0), 0);
  const needsIn = (id: string) => inChannel(needsYou, id)?.items.length ?? 0;

  return (
    <>
      <MoHeader
        left={<span className="w-10" />}
        right={<HeaderActions searchLabel="Search channels" />}
      />
      <MoScroll tabBar>
        {/* The machine's name lives in Settings, Machines (#405), as on the desktop. */}
        <MoTitle
          title="Channels"
          sub={`${listed.length} channels · ${running} ${running === 1 ? 'thread' : 'threads'} running`}
        />
        <div className="px-4">
          <MoGroup>
            <MoListRow
              icon={<OmniMark size={22} state={conductor?.running ? 'delegating' : 'idle'} />}
              label="Conductor"
              sub={conductor?.notes || 'Delegates to crew threads in every channel'}
              right={<Counts needs={needsIn('conductor')} running={conductor?.running ?? 0} />}
              onClick={() => shell.open(href.channel('conductor'))}
              last
            />
          </MoGroup>
        </div>
        {GROUPS.map((g) => {
          const list = listed.filter((c) => g.kinds.includes(c.kind));
          if (!list.length) return null;
          return (
            <MoSection key={g.label} title={g.label} count={list.length}>
              <MoGroup>
                {list.map((c, i) => (
                  <MoListRow
                    key={c.id}
                    icon={<Avatar name={c.name} channelIcon={c.icon} size={30} />}
                    label={`#${c.name}`}
                    sub={c.store_domain || c.github_repo || undefined}
                    right={<Counts needs={needsIn(c.id)} running={c.running} />}
                    onClick={() => shell.open(href.channel(c.id))}
                    last={i === list.length - 1}
                  />
                ))}
              </MoGroup>
            </MoSection>
          );
        })}
        {!listed.length && <MoEmpty>No channels yet. Add one on the desktop, then its threads show here.</MoEmpty>}
      </MoScroll>
    </>
  );
}

const busy = isWorking;

function MoFolderHeader({ folder, onToggle }: { folder: FolderRows; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2.5 px-4 py-3 text-left text-[14px] leading-[1.4] font-medium text-fg-2 hover:text-fg active:bg-[var(--wash)]"
    >
      <Icon name={folder.collapsed ? 'chevronRight' : 'chevronDown'} size={14} className="shrink-0 text-fg-4" />
      <span className="flex-1 truncate">{folder.name}</span>
      <span className="shrink-0 text-[12px] text-fg-4 tabular-nums">{folder.count}</span>
      {folder.running > 0 && <span className="shrink-0 text-[12px] text-fg-4 tabular-nums">{folder.running} running</span>}
    </button>
  );
}

interface FolderRows {
  id: string;
  name: string;
  collapsed: boolean;
  count: number;
  running: number;
  rows: RowItem[];
}

/** One channel: what needs Ben and runs in it, or what finished, and a new thread in the thumb zone. */
export function ChannelScreen({ id }: { id: string }) {
  const shell = useShell();
  const { channel, channelsLoaded, needsYou } = useApp();
  const folders = useFolders();
  const ch: ChannelWithRunning | undefined = channel(id);
  const accept = useCallback((t: Thread) => t.channel_id === id, [id]);
  const list = useLiveThreads(`/channels/${encodeURIComponent(id)}/threads`, accept);
  const now = useNow(60_000);
  const [tab, setTab] = useState<'active' | 'recent'>('active');
  const conductor = id === 'conductor';
  const name = conductor ? 'Conductor' : `#${ch?.name ?? id}`;

  const { active, recent, activeFolders, recentFolders } = useMemo(() => {
    const info = ch ? { name: ch.name, icon: ch.icon } : undefined;
    const needs = new Map((inChannel(needsYou, id)?.items ?? []).map((i) => [i.thread.id, i]));
    const folderMap = new Map<string, { active: RowItem[]; recent: RowItem[] }>();
    const activeRows: RowItem[] = [];
    const recentRows: RowItem[] = [];
    const handoffChildren = new Set((id === 'conductor' ? ch?.handoffs ?? [] : []).flatMap((g) => g.children.map((child) => child.id)));

    for (const t of (list.data ?? []).filter((x) => x.source !== 'team' && !handoffChildren.has(x.id))) {
      const item = needs.get(t.id);
      const row = rowOf(t, info, now);
      const finalRow = item ? { ...row, meta: reasonOf(item).label, status: reasonOf(item).glyph === 'needs' ? 'needs' : row.status } : row;
      const isActive = !!item || busy(t);

      if (t.folder_id) {
        if (!folderMap.has(t.folder_id)) folderMap.set(t.folder_id, { active: [], recent: [] });
        folderMap.get(t.folder_id)![isActive ? 'active' : 'recent'].push(finalRow);
      } else {
        if (isActive) activeRows.push(finalRow);
        else recentRows.push(finalRow);
      }
    }

    const foldersFor = (tab: 'active' | 'recent'): FolderRows[] => (ch?.folders ?? []).flatMap((f) => {
      const rows = folderMap.get(f.id)?.[tab] ?? [];
      return rows.length ? [{
        id: f.id, name: f.name, collapsed: !!f.collapsed, count: rows.length,
        running: rows.filter((r) => r.status === 'running' || r.status === 'queued').length, rows,
      }] : [];
    });

    if (id === 'conductor') {
      for (const group of ch?.handoffs ?? []) {
        if (!group.children.some(isWorking)) continue;
        const inActive = activeRows.some((row) => row.id === group.parent.id);
        if (inActive) continue;
        const parent = rowOf(group.parent, info, now);
        const folder = group.parent.folder_id;
        if (folder) {
          if (!folderMap.has(folder)) folderMap.set(folder, { active: [], recent: [] });
          const rows = folderMap.get(folder)!;
          rows.recent = rows.recent.filter((row) => row.id !== parent.id);
          rows.active.push(parent);
        } else {
          const index = recentRows.findIndex((row) => row.id === parent.id);
          if (index >= 0) recentRows.splice(index, 1);
          activeRows.push(parent);
        }
      }
    }

    return { active: activeRows, recent: recentRows, activeFolders: foldersFor('active'), recentFolders: foldersFor('recent') };
  }, [list.data, needsYou, id, ch, now]);

  const tabFolders = tab === 'active' ? activeFolders : recentFolders;
  const activeCount = active.length + activeFolders.reduce((n, f) => n + f.rows.length, 0);
  const recentCount = recent.length + recentFolders.reduce((n, f) => n + f.rows.length, 0);

  const rows = tab === 'active' ? active : recent;

  if (!ch && channelsLoaded) {
    return (
      <>
        <MoHeader onBack={shell.back} title={name} />
        <MoEmpty>This channel is archived or gone. Its threads are still found by search.</MoEmpty>
      </>
    );
  }

  return (
    <>
      <MoHeader
        onBack={shell.back}
        title={name}
        sub={[KIND_LABEL[ch?.kind ?? ''], ch?.store_domain, ch?.github_repo].filter(Boolean).join(' · ') || undefined}
        right={<MoRound icon="more" label="Channel settings" onClick={() => shell.open(href.settings(id))} />}
      />
      <MoScroll>
        <div className="px-4 pt-2">
          <Segmented
            label="Threads"
            value={tab}
            onChange={setTab}
            options={[
              { id: 'active', label: 'Active', badge: <span className="text-[11px] text-fg-4 tabular-nums">{activeCount}</span> },
              { id: 'recent', label: 'Recent', badge: <span className="text-[11px] text-fg-4 tabular-nums">{recentCount}</span> },
            ]}
          />
        </div>
        <MoSection title={tab === 'active' ? 'Needs you and running' : 'Done'}>
          {rows.length || tabFolders.length ? (
            <div className="flex flex-col">
              {tabFolders.map((folder) => (
                <div key={folder.id}>
                  <MoFolderHeader folder={folder} onToggle={() => void folders.toggle(folder.id)} />
                  {!folder.collapsed && folder.rows.length > 0 && (
                    <div className="bg-surface rounded-lg">
                      <MobileThreadRows items={folder.rows} handoffs={id === 'conductor' ? ch?.handoffs ?? [] : []} onOpen={(r) => shell.open(href.thread(r.id))} />
                    </div>
                  )}
                </div>
              ))}
              {rows.length > 0 && (
                <>
                  {tabFolders.length > 0 && <div className="px-4 py-2 text-[12px] text-fg-4">Ungrouped</div>}
                  <MobileThreadRows items={rows} handoffs={id === 'conductor' ? ch?.handoffs ?? [] : []} onOpen={(r) => shell.open(href.thread(r.id))} />
                </>
              )}
            </div>
          ) : (
            <MoEmpty>
              {list.loading && !list.data
                ? 'Loading'
                : tab === 'active'
                  ? `Nothing running in ${name}. Start a thread below; crew threads the Conductor delegates here show up too.`
                  : `Nothing finished in ${name} yet.`}
            </MoEmpty>
          )}
        </MoSection>
      </MoScroll>
      <div className="shrink-0 px-4 pt-2" style={{ paddingBottom: bottomInset(0, 16) }}>
        <button
          type="button"
          onClick={() => shell.sheet({ name: 'new', channel: id })}
          className="mo-press flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-fg text-[15px] leading-none font-medium text-on-ink"
        >
          <Icon name="plus" size={18} />
          {conductor ? 'Ask the Conductor' : `New thread in ${name}`}
        </button>
      </div>
    </>
  );
}

function MobileThreadRows({ items, handoffs, onOpen }: {
  items: RowItem[];
  handoffs: ConductorHandoffGroup[];
  onOpen: (row: RowItem) => void;
}) {
  const delegates = delegatesByParent(handoffs);
  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <MoDelegatedRow key={item.id} it={item} delegated={delegates.get(item.id)} last={i === items.length - 1} onOpen={() => onOpen(item)} />
      ))}
    </div>
  );
}
