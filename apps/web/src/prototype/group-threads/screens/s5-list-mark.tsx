// PROTOTYPE, throwaway. Screen 5: the thread's status mark in the thread list, with avatars for the agents at work.
// The mark is the busiest state among the thread's agents (Needs you, then Working, then Done, ADR 0019). The list
// panel here is drawn by the prototype, in ListPanel's own markup, so its rows can change; the page beside it is the
// group thread from screen 1.
//
// Ben's pick: B on desktop (the faces are the mark), C on the phone (a second line). B shows Needs you and Working at
// once: the face of the agent that waits on Ben leads the stack, in the Needs you ring with the Needs you diamond on
// it, and the faces of the agents still working follow in the Working ring.
import type { ReactNode } from 'react';
import type { Mark } from '@omni/shared/status.ts';
import { AGENTS, CHANNELS, GROUP, THREAD, type AgentId } from '../data.ts';
import { Messages } from '../messages.tsx';
import { AgentAvatar, ComposerBox, DesktopThread, Facepile, HeadFaces, RunPill, ThreadHead } from '../parts.tsx';
import { Icon, IconButton, StatusDot } from '../../../components/ui.tsx';
import { MoHeader, MoRound } from '../../../mobile/parts.tsx';
import type { Screen } from './types.ts';

interface Row {
  title: string;
  mark: Mark;
  /** Agents working now. */
  running: AgentId[];
  /** The agent that waits on Ben, when one does. */
  asks?: AgentId;
  /** An agent whose turn failed while others still work: the mark keeps the working faces, the row gets a red dot. */
  failed?: AgentId;
  lead: AgentId;
  time: string;
  active?: boolean;
}

const ROWS: Row[] = [
  { title: THREAD.title, mark: 'working', running: ['builder', 'designer'], lead: 'builder', time: '12:20', active: true },
  { title: 'Inbox first paint on the phone', mark: 'question', running: ['designer'], asks: 'builder', lead: 'builder', time: '11:58' },
  { title: 'Machine tiles on the dashboard', mark: 'failed', running: ['builder'], failed: 'designer', lead: 'builder', time: '11:52' },
  { title: 'Release notes for 0.1.44', mark: 'question', running: [], asks: 'writer', lead: 'writer', time: '11:40' },
  { title: 'Terms for the Restage pilot', mark: 'working', running: ['nomos', 'researcher', 'reviewer', 'writer'], lead: 'nomos', time: '11:12' },
  { title: 'Sync errors on the VPS last week', mark: 'done', running: [], lead: 'hermes', time: '10:30' },
  { title: 'Usage card rounds 99.6% up to 100%', mark: 'done', running: [], lead: 'builder', time: 'Yesterday' },
  { title: 'Folder drag on the phone', mark: 'failed', running: [], lead: 'builder', time: 'Yesterday' },
];

type Kind = 'pile' | 'face' | 'line';

const names = (ids: AgentId[]) => (ids.length <= 2 ? ids.map((i) => AGENTS[i].name).join(' and ') : `${AGENTS[ids[0]].name} and ${ids.length - 1} more`);

/** What the row says in words, for its tooltip and for screen readers, whatever it draws. */
const said = (r: Row) =>
  [
    r.asks ? `${AGENTS[r.asks].name} needs you` : null,
    r.running.length ? `${names(r.running)} working` : null,
    r.failed ? `${AGENTS[r.failed].name} failed` : null,
    !r.asks && !r.running.length ? (r.mark === 'failed' ? 'Failed' : 'Done') : null,
  ]
    .filter(Boolean)
    .join(', ');

// ---------- B: the faces are the mark ----------

/**
 * One face in the mark: the Working ring, or the Needs you ring with the Needs you diamond on its bottom-left corner.
 * Left, because the next face overlaps the right side. The diamond says it in shape too, where the ring's color is
 * close to the avatar's own (Builder's orange).
 */
function StateFace({ id, needs, size }: { id: AgentId; needs?: boolean; size: number }) {
  const badge = Math.max(9, Math.round(size * 0.5));
  return (
    <span className="relative inline-grid shrink-0">
      <AgentAvatar a={AGENTS[id]} size={size} ring={!needs} needs={needs} />
      {needs && (
        <span className="absolute grid place-items-center rounded-full bg-bg" style={{ width: badge, height: badge, left: -badge * 0.35, bottom: -badge * 0.35 }}>
          <StatusDot mark="question" size={Math.max(7, badge - 3)} />
        </span>
      )}
    </span>
  );
}

/**
 * The mark slot of variant B. Faces only while an agent works or waits on Ben; any other state keeps its mark. The
 * agent that waits on Ben comes first and sits on top, so the slot leads with the busiest state; the working ones
 * follow under it. Two faces at most: past two, one face and a +N count. The row's tooltip and label name them all.
 */
function FaceMark({ r, size }: { r: Row; size: number }) {
  const faces = [...(r.asks ? [{ id: r.asks, needs: true }] : []), ...r.running.map((id) => ({ id, needs: false }))];
  if (!faces.length)
    return (
      <span className="grid shrink-0 place-items-center" style={{ width: size }}>
        <StatusDot mark={r.mark} size={size > 20 ? 9 : 7} />
      </span>
    );
  const shown = faces.length > 2 ? faces.slice(0, 1) : faces;
  const more = faces.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((f, i) => (
        <span key={f.id} className="relative rounded-full" style={{ marginLeft: i ? -size * 0.3 : 0, zIndex: shown.length - i }}>
          <StateFace id={f.id} needs={f.needs} size={size} />
        </span>
      ))}
      {more > 0 && (
        <span className="ml-0.5 shrink-0 font-num font-semibold text-fg-2 tabular-nums" style={{ fontSize: Math.max(10.5, size * 0.55) }}>
          +{more}
        </span>
      )}
    </span>
  );
}

// ---------- desktop rows ----------

function DesktopRow({ r, kind }: { r: Row; kind: Kind }) {
  const base = `item group/row flex items-center gap-2 px-3 text-[12.5px] ml-1 ${r.active ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg'}`;
  if (kind === 'line')
    return (
      <a href="#" title={said(r)} aria-label={`${r.title}: ${said(r)}`} aria-current={r.active ? 'page' : undefined} data-active={r.active || undefined} className={`${base} h-auto items-start py-1.5`}>
        <span className="mt-[5px] grid w-3 shrink-0 place-items-center">
          <StatusDot mark={r.mark} size={7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{r.title}</span>
          <SecondLine r={r} size={14} />
        </span>
      </a>
    );
  return (
    <a href="#" title={said(r)} aria-label={`${r.title}: ${said(r)}`} aria-current={r.active ? 'page' : undefined} data-active={r.active || undefined} className={`${base} h-7`}>
      {kind === 'face' ? (
        // One slot width for every row, so the titles line up whether a row draws a mark, one face or two.
        <span className="flex w-[34px] shrink-0 items-center">
          <FaceMark r={r} size={18} />
        </span>
      ) : (
        <span className="grid w-3 shrink-0 place-items-center">
          <StatusDot mark={r.mark} size={r.mark === 'working' ? 8 : 7} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{r.title}</span>
      {kind === 'pile' && r.running.length > 0 && <Facepile ids={r.running} size={16} max={2} />}
      {kind === 'face' && r.failed && <FailDot id={r.failed} />}
    </a>
  );
}

/**
 * A failure beside agents still working (Ben, 2026-11-20): Failed outranks Working in the order, not in the mark, so the
 * mark keeps the working faces and the row carries a red dot.
 */
function FailDot({ id }: { id: AgentId }) {
  return <span title={`${AGENTS[id].name} failed`} className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--needs)]" />;
}

/** C's second line: who asks Ben, then who works, in faces and words. */
function SecondLine({ r, size, phone }: { r: Row; size: number; phone?: boolean }) {
  return (
    <span className={`mt-0.5 flex min-w-0 items-center gap-1.5 font-normal text-fg-3 ${phone ? 'text-[12.5px] leading-[1.35]' : 'text-[11.5px]'}`}>
      {r.asks && (
        <>
          <StateFace id={r.asks} needs size={size} />
          <span className="shrink-0 text-fg-2">{AGENTS[r.asks].name} asks you</span>
          {r.running.length > 0 && <span>·</span>}
        </>
      )}
      {r.running.length > 0 ? (
        <>
          <Facepile ids={r.running} size={size} max={3} ring={r.running} />
          <span className="truncate">{r.running.length > 2 ? `${r.running.length} working` : `${names(r.running)} working`}</span>
          {r.failed && (
            <>
              <span>·</span>
              <FailDot id={r.failed} />
              <span className="shrink-0 text-fg-2">{AGENTS[r.failed].name} failed</span>
            </>
          )}
        </>
      ) : (
        !r.asks && (
          <span className="truncate">
            {AGENTS[r.lead].name} · {r.mark === 'failed' ? 'Failed' : 'Done'}
          </span>
        )
      )}
    </span>
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
        head={<ThreadHead channel={CHANNELS.omni} title={THREAD.title} right={<HeadFaces ids={['builder', 'reviewer', 'hermes']} running={['reviewer', 'hermes']} />} />}
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
  if (kind === 'face' && (r.asks || r.running.length)) mark = <FaceMark r={r} size={30} />;
  else
    mark = (
      <span className="relative grid h-9 w-9 shrink-0 place-items-center">
        <AgentAvatar a={lead} size={36} />
        <span className="absolute -right-px -bottom-px grid h-3.5 w-3.5 place-items-center rounded-full bg-bg">
          {/* A failure beside a working agent ranks first in the order, not in the mark: the dot stays Working. */}
          <StatusDot mark={r.failed && r.running.length ? 'working' : r.mark} size={8} />
        </span>
      </span>
    );
  const meta = r.asks ? `${AGENTS[r.asks].name} asks you` : r.running.length ? 'Working' : r.mark === 'failed' ? 'Failed' : 'Done';
  return (
    <button type="button" title={said(r)} aria-label={`${r.title}: ${said(r)}`} className="mo-row flex w-full min-w-0 items-center gap-3 px-1 py-2.5 text-left">
      <span className={`flex shrink-0 justify-center ${kind === 'face' ? 'w-[50px]' : 'w-9'}`}>{mark}</span>
      <span className={`-mb-2.5 flex min-w-0 flex-1 flex-col gap-0.5 pb-2.5 ${last ? '' : 'border-b border-line'}`}>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] leading-[1.3] text-fg">{r.title}</span>
          <span className="shrink-0 text-[12px] leading-none text-fg-3 tabular-nums">{r.time}</span>
        </span>
        {kind === 'line' ? (
          <SecondLine r={r} size={16} phone />
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-[1.35] text-fg-3">
            {kind === 'pile' && r.running.length > 0 && <Facepile ids={r.running} size={16} max={3} ring={r.running} />}
            <span className="min-w-0 truncate">{kind === 'face' ? said(r) : meta}</span>
          </span>
        )}
      </span>
    </button>
  );
}

const phone = (kind: Kind) => () => (
  <div className="flex h-full flex-col bg-bg">
    <MoHeader onBack={() => {}} title="Omni OS" sub="8 threads · 4 at work" right={<MoRound icon="plus" label="New thread" ink />} />
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
  pick: 'B',
  variants: [
    { key: 'A', name: 'Mark + faces', idea: 'The mark stays as it is; small faces of who runs sit at the row’s end, where the harness logo is today.', desktop: desktop('pile'), phone: phone('pile') },
    {
      key: 'B',
      name: 'Faces are the mark',
      idea: 'Desktop: faces take the mark’s place while agents work or ask; the asker leads with the Needs you ring and diamond. Phone: the second line (C).',
      desktop: desktop('face'),
      phone: phone('line'),
    },
    { key: 'C', name: 'Second line', idea: 'Two-line rows: the mark and title, then who runs or asks, in faces and words.', desktop: desktop('line'), phone: phone('line') },
    { key: 'D', name: 'Faces on the phone too', idea: 'B’s faces as the mark on the phone as well, in place of the lead’s avatar.', desktop: desktop('face'), phone: phone('face') },
  ],
};
