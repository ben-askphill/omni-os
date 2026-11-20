// PROTOTYPE, throwaway. Screen 5: the thread's status mark in the thread list, with avatars for the agents running.
// The mark is the busiest state among the thread's agents (Needs you, then Working, then Done, ADR 0019). The list
// panel here is drawn by the prototype, in ListPanel's own markup, so its rows can change; the page beside it is the
// group thread from screen 1.
import type { ReactNode } from 'react';
import type { Mark } from '@omni/shared/status.ts';
import { AGENTS, CHANNELS, GROUP, THREAD, type AgentId } from '../data.ts';
import { Messages } from '../messages.tsx';
import { AgentAvatar, ComposerBox, DesktopThread, Facepile, RunPill, ThreadHead } from '../parts.tsx';
import { Icon, IconButton, StatusDot } from '../../../components/ui.tsx';
import { MoHeader, MoRound } from '../../../mobile/parts.tsx';
import type { Screen } from './types.ts';

interface Row {
  title: string;
  mark: Mark;
  /** Agents running now. */
  running: AgentId[];
  /** The agent that waits on Ben, when one does. */
  asks?: AgentId;
  lead: AgentId;
  time: string;
  active?: boolean;
}

const ROWS: Row[] = [
  { title: THREAD.title, mark: 'working', running: ['builder', 'designer'], lead: 'builder', time: '12:20', active: true },
  { title: 'Inbox first paint on the phone', mark: 'question', running: ['designer'], asks: 'builder', lead: 'builder', time: '11:58' },
  { title: 'Release notes for 0.1.44', mark: 'working', running: ['writer'], lead: 'writer', time: '11:40' },
  { title: 'Terms for the Restage pilot', mark: 'working', running: ['nomos', 'researcher', 'reviewer', 'writer'], lead: 'nomos', time: '11:12' },
  { title: 'Sync errors on the VPS last week', mark: 'done', running: [], lead: 'hermes', time: '10:30' },
  { title: 'Usage card rounds 99.6% up to 100%', mark: 'done', running: [], lead: 'builder', time: 'Yesterday' },
  { title: 'Folder drag on the phone', mark: 'failed', running: [], lead: 'builder', time: 'Yesterday' },
];

type Kind = 'pile' | 'face' | 'line';

const names = (ids: AgentId[]) => (ids.length <= 2 ? ids.map((i) => AGENTS[i].name).join(' and ') : `${AGENTS[ids[0]].name} and ${ids.length - 1} more`);

/** What the row says in words, for its tooltip and for screen readers, whatever it draws. */
const said = (r: Row) =>
  [r.asks ? `${AGENTS[r.asks].name} needs you` : null, r.running.length ? `${names(r.running)} working` : null, !r.asks && !r.running.length ? (r.mark === 'failed' ? 'Failed' : 'Done') : null]
    .filter(Boolean)
    .join(', ');

// ---------- the mark slot, per variant ----------

/** B: the running agents' faces are the mark; any other state keeps its own mark. */
function FaceMark({ r, size }: { r: Row; size: number }) {
  if (r.mark !== 'working' || !r.running.length) return <StatusDot mark={r.mark} size={size === 16 ? 7 : 8} />;
  // Two faces at most: a third would push the title. The row's tooltip names them all.
  return <Facepile ids={r.running} size={size} max={2} ring={r.running} count={false} />;
}

function DesktopRow({ r, kind }: { r: Row; kind: Kind }) {
  const base = `item group/row flex items-center gap-2 px-3 text-[12.5px] ml-1 ${r.active ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg'}`;
  if (kind === 'line')
    return (
      <a href="#" title={said(r)} aria-current={r.active ? 'page' : undefined} data-active={r.active || undefined} className={`${base} h-auto items-start py-1.5`}>
        <span className="mt-[5px] grid w-3 shrink-0 place-items-center">
          <StatusDot mark={r.mark} size={7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{r.title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] font-normal text-fg-3">
            {r.asks && (
              <>
                <AgentAvatar a={AGENTS[r.asks]} size={14} needs />
                <span className="shrink-0 text-fg-2">asks you</span>
                {r.running.length > 0 && <span>·</span>}
              </>
            )}
            {r.running.length > 0 ? (
              <>
                <Facepile ids={r.running} size={14} max={3} />
                <span className="truncate">{r.running.length > 2 ? `${r.running.length} working` : `${names(r.running)} working`}</span>
              </>
            ) : (
              !r.asks && (
                <>
                  <AgentAvatar a={AGENTS[r.lead]} size={14} />
                  <span className="truncate">
                    {AGENTS[r.lead].name} · {r.time}
                  </span>
                </>
              )
            )}
          </span>
        </span>
      </a>
    );
  return (
    <a href="#" title={said(r)} aria-current={r.active ? 'page' : undefined} data-active={r.active || undefined} className={`${base} h-7`}>
      <span className={`grid shrink-0 place-items-center ${kind === 'face' && r.mark === 'working' && r.running.length > 1 ? 'w-[26px]' : kind === 'face' && r.mark === 'working' ? 'w-4' : 'w-3'}`}>
        {kind === 'face' ? <FaceMark r={r} size={16} /> : <StatusDot mark={r.mark} size={r.mark === 'working' ? 8 : 7} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{r.title}</span>
      {kind === 'pile' && r.running.length > 0 && <Facepile ids={r.running} size={16} max={2} />}
      {kind === 'face' && r.asks && <Facepile ids={r.running} size={14} max={2} ring={r.running} />}
    </a>
  );
}

/** ListPanel's channel list, in its own markup (PanelHeader, New thread, Recent). */
function Panel({ kind }: { kind: Kind }) {
  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-[var(--line)] bg-surface">
      <div className="flex h-[62px] shrink-0 items-end gap-1 px-3 pb-1.5">
        <h2 className="min-w-0 flex-1 pl-2.5 text-[15px] leading-[1.25] font-semibold tracking-[-0.01em] text-fg">Omni OS</h2>
        <IconButton icon="folderPlus" label="New folder" size={15} />
      </div>
      <div className="px-3 pt-2">
        <button type="button" className="press flex h-9 w-full items-center justify-center gap-2 rounded-full bg-fg text-[13px] font-medium text-on-ink">
          <Icon name="plus" size={15} strokeWidth={2} /> New thread
        </button>
      </div>
      <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="caption px-3 pt-1 pb-2">Recent</div>
        <div className="space-y-px">
          {ROWS.map((r) => (
            <DesktopRow key={r.title} r={r} kind={kind} />
          ))}
        </div>
      </div>
    </aside>
  );
}

const desktop = (kind: Kind) => () => (
  <div className="flex h-full min-h-0">
    <Panel kind={kind} />
    <div className="min-w-0 flex-1">
      <DesktopThread
        head={<ThreadHead channel={CHANNELS.omni} title={THREAD.title} />}
        composer={
          <ComposerBox>
            <RunPill label="Builder · Opus 5.5" />
          </ComposerBox>
        }
      >
        <Messages list={GROUP.slice(0, 3)} />
      </DesktopThread>
    </div>
  </div>
);

// ---------- phone: the channel's thread list ----------

function PhoneRow({ r, kind, last }: { r: Row; kind: Kind; last?: boolean }) {
  const lead = AGENTS[r.lead];
  let mark: ReactNode;
  if (kind === 'face' && r.mark === 'working' && r.running.length) mark = <Facepile ids={r.running} size={30} max={2} ring={r.running} count={false} />;
  else
    mark = (
      <span className="relative grid h-9 w-9 shrink-0 place-items-center">
        <AgentAvatar a={lead} size={36} />
        <span className="absolute -right-px -bottom-px grid h-3.5 w-3.5 place-items-center rounded-full bg-bg">
          <StatusDot mark={r.mark} size={8} />
        </span>
      </span>
    );
  const meta =
    kind === 'line' || kind === 'face'
      ? [r.asks ? `${AGENTS[r.asks].name} asks you` : null, r.running.length ? `${names(r.running)} working` : null].filter(Boolean).join(' · ') || `${lead.name} · ${r.mark === 'failed' ? 'Failed' : 'Done'}`
      : r.asks
        ? `${AGENTS[r.asks].name} asks you`
        : r.running.length
          ? 'Working'
          : r.mark === 'failed'
            ? 'Failed'
            : 'Done';
  return (
    <button type="button" title={said(r)} className="mo-row flex w-full min-w-0 items-center gap-3 px-1 py-2.5 text-left">
      <span className={`flex shrink-0 justify-center ${kind === 'face' && r.running.length > 1 && r.mark === 'working' ? 'w-[50px]' : 'w-9'}`}>{mark}</span>
      <span className={`-mb-2.5 flex min-w-0 flex-1 flex-col gap-0.5 pb-2.5 ${last ? '' : 'border-b border-line'}`}>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] leading-[1.3] text-fg">{r.title}</span>
          <span className="shrink-0 text-[12px] leading-none text-fg-3 tabular-nums">{r.time}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-[1.35] text-fg-3">
          {kind === 'pile' && r.running.length > 0 && <Facepile ids={r.running} size={16} max={3} ring={r.running} />}
          {kind === 'line' && r.asks && <AgentAvatar a={AGENTS[r.asks]} size={14} needs />}
          {kind === 'line' && r.running.length > 0 && <Facepile ids={r.running} size={14} max={3} />}
          <span className="min-w-0 truncate">{meta}</span>
        </span>
      </span>
    </button>
  );
}

const phone = (kind: Kind) => () => (
  <div className="flex h-full flex-col bg-bg">
    <MoHeader onBack={() => {}} title="Omni OS" sub="7 threads · 4 working" right={<MoRound icon="plus" label="New thread" ink />} />
    <div className="mo-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-10">
      <div className="flex flex-col">
        {ROWS.map((r, i) => (
          <PhoneRow key={r.title} r={r} kind={kind} last={i === ROWS.length - 1} />
        ))}
      </div>
    </div>
  </div>
);

export const listMark: Screen = {
  id: 5,
  name: 'Mark in the thread list',
  place: { kind: 'own-list', channel: 'omni-os', hash: `#/t/${THREAD.id}` },
  variants: [
    { key: 'A', name: 'Mark + faces', idea: 'The mark stays as it is; small faces of who runs sit at the row’s end, where the harness logo is today.', desktop: desktop('pile'), phone: phone('pile') },
    { key: 'B', name: 'Faces are the mark', idea: 'While agents work, their faces with the Working ring take the mark’s place; other states keep the mark.', desktop: desktop('face'), phone: phone('face') },
    { key: 'C', name: 'Second line', idea: 'Two-line rows: the mark and title, then who runs or asks, in faces and words.', desktop: desktop('line'), phone: phone('line') },
  ],
};
