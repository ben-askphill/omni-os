import { useCallback, useMemo, useState } from 'react';
import type { ChannelWithRunning, Thread } from '../api.ts';
import { OmniMark } from '../components/brand.tsx';
import { useLiveThreads } from '../components/ThreadList.tsx';
import { Avatar, Icon, Segmented, StatusDot } from '../components/ui.tsx';
import { inChannel, reasonOf } from '../needs-you.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { bottomInset, MoEmpty, MoGroup, MoHeader, MoListRow, MoRound, MoRows, MoScroll, MoSection, MoTitle } from './parts.tsx';
import { rowOf, type RowItem } from './rows.ts';
import { useShell } from './shell.tsx';

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
  const { channels, needsYou, profile, channel } = useApp();
  const listed = channels.filter((c) => !c.archived && c.id !== 'conductor');
  const conductor = channel('conductor');
  const running = channels.reduce((n, c) => n + (c.running || 0), 0);
  const needsIn = (id: string) => inChannel(needsYou, id)?.items.length ?? 0;
  const initial = (profile?.name || 'You').trim().slice(0, 1).toUpperCase();

  return (
    <>
      <MoHeader
        left={<span className="w-10" />}
        right={
          <>
            <MoRound icon="search" label="Search channels" onClick={() => shell.sheet({ name: 'search' })} />
            <MoRound label="Settings" onClick={() => shell.open(href.settingsPage())}>
              <span className="font-rounded text-[14px] leading-none font-semibold">{initial}</span>
            </MoRound>
          </>
        }
      />
      <MoScroll tabBar>
        <MoTitle title="Channels" sub={`${listed.length} channels · ${running} ${running === 1 ? 'thread' : 'threads'} running`} />
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

const busy = (t: Thread) => t.status === 'running' || t.status === 'queued';

/** One channel: what needs Ben and runs in it, or what finished, and a new thread in the thumb zone. */
export function ChannelScreen({ id }: { id: string }) {
  const shell = useShell();
  const { channel, channelsLoaded, needsYou } = useApp();
  const ch: ChannelWithRunning | undefined = channel(id);
  const accept = useCallback((t: Thread) => t.channel_id === id, [id]);
  const list = useLiveThreads(`/channels/${encodeURIComponent(id)}/threads`, accept);
  const now = useNow(60_000);
  const [tab, setTab] = useState<'active' | 'recent'>('active');
  const conductor = id === 'conductor';
  const name = conductor ? 'Conductor' : `#${ch?.name ?? id}`;

  const { active, recent } = useMemo(() => {
    const info = ch ? { name: ch.name, icon: ch.icon } : undefined;
    const needs = new Map((inChannel(needsYou, id)?.items ?? []).map((i) => [i.thread.id, i]));
    const active: RowItem[] = [];
    const recent: RowItem[] = [];
    for (const t of (list.data ?? []).filter((x) => x.source !== 'team')) {
      const item = needs.get(t.id);
      const row = rowOf(t, info, now);
      if (item) active.push({ ...row, meta: reasonOf(item).label, status: reasonOf(item).glyph === 'needs' ? 'needs' : row.status });
      else if (busy(t)) active.push(row);
      else recent.push(row);
    }
    return { active, recent };
  }, [list.data, needsYou, id, ch, now]);
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
              { id: 'active', label: 'Active', badge: <span className="text-[11px] text-fg-4 tabular-nums">{active.length}</span> },
              { id: 'recent', label: 'Recent', badge: <span className="text-[11px] text-fg-4 tabular-nums">{recent.length}</span> },
            ]}
          />
        </div>
        <MoSection title={tab === 'active' ? 'Needs you and running' : 'Done'}>
          {rows.length ? (
            <MoRows items={rows} onOpen={(r) => shell.open(href.thread(r.id))} />
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
