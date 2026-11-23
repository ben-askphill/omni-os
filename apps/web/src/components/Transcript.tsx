import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFindOpens } from '../transcript/find-target.ts';
import type { Artifact, EventRow, Thread } from '../api.ts';
import { duration, plural } from '../format.ts';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';
import { DelegationCard } from './Delegation.tsx';
import { AskItem } from './AskCard.tsx';
import { ReportBody } from './thread/ReportBody.tsx';
import { RemoteMark } from './ConnectAgent.tsx';
import { Folded } from './Folded.tsx';
import { HtmlRender } from './HtmlRender.tsx';
import { PublishedCard } from './Published.tsx';
import { CloudAgentCard } from './thread/CloudAgentCard.tsx';
import { PRWakeList } from './thread/PRWatch.tsx';
import { ClippedNote, HistoryCtx, HistoryEdgeRow } from './thread/HistoryEdgeRow.tsx';
import { QuestionCard } from './thread/QuestionCard.tsx';
import { Markdown } from './Markdown.tsx';
import { Avatar, COPY_SAID, CopyStatus, Icon, Loader, StatusDot, StatusPill, useCopy } from './ui.tsx';
import { SOURCE_TAG } from '@omni/shared/slash-menu.ts';
import { slashPieces } from '@omni/shared/slash-pills.ts';
import { statusLabel, turnStart } from '@omni/shared/status-line.ts';
import { PHASE, turnPhase, type Mark } from '@omni/shared/status.ts';
import { agentShows } from '@omni/shared/crew-eyes.ts';
import { conductorChannelLook, type FaceShows } from '@omni/shared/agent-avatar.ts';
import { ThinkingLine } from './thread/ThinkingLine.tsx';
import { AuthorLine, REPLY_INDENT, type ReplyRun } from './AuthorLine.tsx';
import { seatRun, type ThreadMember } from '@omni/shared/members.ts';
import { RemoteLockLine } from './thread/RemoteLockLine.tsx';
import { remoteReadsOpen } from '@omni/shared/remote-agent.ts';
import { AgentAvatar, useAgent, type AgentLook } from './AgentAvatar.tsx';
import { CONDUCTOR_CHANNEL } from '@omni/shared/channel-icon.ts';
import { leadMessage } from '@omni/shared/members.ts';
import type { SlashHit } from '@omni/shared/slash.ts';
import { publishedFrom, type Published } from '@omni/shared/published.ts';
import { renderedFrom } from '@omni/shared/html-render.ts';
import { handoverNote, switchText } from '@omni/shared/run-switch.ts';
import { ContextChips, hasContext } from '../message-context/ContextChips.tsx';
import { MentionText } from '../message-context/MentionText.tsx';
import { sentContext } from '@omni/shared/message-context-machine.ts';
import { SentTo } from '../message-context/agent-mention.tsx';
import { buildItems, buildTasks, isReply, keepSame, replyAt, replyHeads, replyTails, same, seatedDelegationsAt, type Item, toolLabel, toolSummary, type ReportP, type ResultP, type ModLine, type SwitchItem, type ToolCall, type UserP, type MemberP, memberLine } from '@omni/shared/transcript-fold.ts';
import { showsSteps, turnsOf, turnSteps, type StepsView } from '@omni/shared/steps.ts';
import { answersFor, branchOf, delegations, mergeTasks, shownAnswers, splitGroup, withLive, type Branch } from '../transcript/delegation.ts';
import { defers, LIVE_ROWS } from '../transcript/defer.ts';
import { atStart, historyEdges, type Clipped } from '@omni/shared/history.ts';
import { clock, toDate } from '@omni/shared/format.ts';
import type { ThreadHistory } from '../pages/useThreadHistory.ts';

import { AgentRow, ConnectorRow, flatten, TaskCtx } from './thread/ToolRows.tsx';
import { connectorGroups } from '@omni/shared/connectors.ts';
import { StepsCard } from './thread/StepsCard.tsx';
import { LanesBlock, type LaneItems } from './thread/Lanes.tsx';
import { CollisionFlag } from './thread/Collision.tsx';
import { MergeRiskCard } from './thread/MergeRiskCard.tsx';
import { laneFold, lanesEnded, type LaneFolded } from '@omni/shared/lanes.ts';
import { Attachments } from './thread/Attachments.tsx';
import { QueuedMessages, SendingMessages } from './thread/PendingMessages.tsx';

export { toolLabel, toolSummary, type ToolCall };
// The thread screens import these from here.
export { Attachments, QueuedMessages, SendingMessages };

const NO_THREADS: Thread[] = [];
const NO_ARTIFACTS: Artifact[] = [];
const NO_REPORTS = new Map<string, string>();

/** Task state by the Agent call's tool_use id. */

/** The pages the thread published, each under the last tool group that published it, so a republish moves the card down. */
function publishedByGroup(items: Item[]) {
  const last = new Map<string, { key: number; p: Published }>();
  for (const it of items) {
    if (it.type !== 'tools') continue;
    for (const c of flatten(it.calls)) {
      const p = publishedFrom(c.name, c.input, c.result);
      if (!p) continue;
      last.delete(p.url);
      last.set(p.url, { key: it.key, p });
    }
  }
  const out = new Map<number, Published[]>();
  for (const { key, p } of last.values()) out.set(key, [...(out.get(key) ?? []), p]);
  return out;
}

const SOURCE_LABEL: Record<string, string> = {
  conductor: 'from Conductor',
  team: 'Team',
  automation: 'Automation',
  capture: 'Captured',
  import: 'Imported',
  limit: 'After the usage limit',
  'pr-watch': 'PR watch',
  omni: 'From Omni',
};


/** A message's leading command as a pill. Hover shows its description; a tap spells it out under the text. */
function CommandPill({ label, cmd, open, onToggle }: { label: string; cmd: SlashHit; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={cmd.description || undefined}
      aria-expanded={open}
      className="rounded-md bg-surface-3 px-1.5 py-px font-mono text-[13px] font-medium whitespace-nowrap text-fg"
    >
      {label}
    </button>
  );
}

/**
 * A message's text as its bubble shows it: a pill for each command it names, which a press opens to its description,
 * and the rest with its mentions. `visible` cuts it there, with an ellipsis. The desktop and phone transcripts use it.
 */
export function UserText({ text, slash, records, visible }: { text: string; slash?: UserP['slash']; records?: UserP['context']; visible?: number }) {
  // Where the pill whose description is open starts.
  const [about, setAbout] = useState<number | null>(null);
  const pieces = slashPieces(text, slash, visible ?? text.length);
  const open = pieces.find((x) => x.hit?.start === about)?.hit;
  return (
    <>
      {pieces.map(({ text: t, hit }, i) =>
        hit ? (
          <CommandPill key={i} label={t} cmd={hit} open={hit === open} onToggle={() => setAbout((a) => (a === hit.start ? null : hit.start))} />
        ) : (
          <MentionText key={i} text={t} records={records} />
        ),
      )}
      {visible !== undefined && '...'}
      {open && (
        <span className="mt-1.5 block border-t border-line pt-1.5 text-[12.5px] leading-snug whitespace-normal text-fg-3">
          {open.description || 'No description'} <span className="text-fg-3">· {SOURCE_TAG[open.source]}</span>
        </span>
      )}
    </>
  );
}

/** A small Copy control under a message, shown on hover or keyboard focus (always on touch). Copies the source text. */
function CopyMsg({ text, align = 'start' }: { text: string; align?: 'start' | 'end' }) {
  const { state, copy, icon } = useCopy();
  if (!text.trim()) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Copy message"
        title="Copy message"
        onClick={() => void copy(text)}
        className={`hov press mt-0.5 inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-fg-3 opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 hover:text-fg focus-visible:opacity-100 data-[copy=failed]:opacity-100 [@media(hover:none)]:opacity-100 ${align === 'end' ? 'self-end' : 'self-start'}`}
        data-copy={state}
      >
        <Icon name={icon} size={12} /> {state === 'idle' ? 'Copy' : COPY_SAID[state]}
      </button>
      <CopyStatus state={state} />
    </>
  );
}

/**
 * Ben's message, or the one an agent or automation sent. `fold` keeps it to its first lines (a delegated thread's brief).
 * `lazy`: its images wait until they near the screen, as older rows do; the newest rows load them at once.
 */
function UserBubble({ p, at, threadId, event, clipped, fold, lazy, from }: { p: UserP; at: string; threadId: string; event: number; clipped?: Clipped; fold?: boolean; lazy?: boolean; from?: string }) {
  const [more, setMore] = useState(false);
  // The find bar's match is in this message: a long one shows all of it.
  const found = useFindOpens((t) => t === event, () => setMore(true));
  const text = p.text ?? '';
  // A clipped message shows all it came with; Show all under it loads the rest. A folded one has its own Show more.
  const long = !clipped && !fold && text.length > 1400;
  const cut = long && !more && !found;
  const { crew } = useApp();
  // A team lead's message to its members (slice 6) names who sent it and who it went to.
  const lead = leadMessage(p, from, (a) => crew.find((r) => r.id === a)?.name ?? a);
  const label = lead?.from ?? (p.source ? SOURCE_LABEL[p.source] : undefined);
  const how = p.dropped ? null : p.mode === 'steer' ? 'Steered' : p.mode === 'interrupt' ? 'Interrupted and sent' : null;
  const sent = useMemo(() => sentContext(text, p.context), [text, p.context]);
  // A lead's message names its members in `to`, not as agent mentions, and they show the same way.
  const to = lead ? [...sent.to, ...lead.to.filter((m) => !sent.to.some((x) => x.agent === m.agent))] : sent.to;
  const body = <UserText text={text} slash={p.slash} records={p.context} visible={cut ? 1200 : undefined} />;
  return (
    <div className={`group/msg flex flex-col items-end ${p.dropped ? 'opacity-60' : ''}`}>
      <div className="mb-1 flex flex-wrap items-center justify-end gap-x-2 text-[11.5px] text-fg-3">
        {label && <span className={`font-medium ${p.source === 'conductor' ? 'text-live-text' : ''}`}>{label}</span>}
        {how && (
          <span className={`inline-flex items-center gap-1 font-medium ${p.mode === 'interrupt' ? 'text-fg-2' : ''}`}>
            <Icon name={p.mode === 'interrupt' ? 'stop' : 'send'} size={11} /> {how}
          </span>
        )}
        {p.dropped && (
          <span className="inline-flex items-center gap-1 font-medium" title={p.undelivered ?? 'The run ended before the agent read this message'}>
            <Icon name="x" size={11} /> {p.undelivered ? 'Not delivered' : 'Not sent'}
          </span>
        )}
        <SentTo agents={to} />
        <span className="font-num text-[11px] text-fg-3">{clock(toDate(at))}</span>
      </div>
      {p.attachments?.length ? <Attachments threadId={threadId} items={p.attachments} lazy={lazy} /> : null}
      <ContextChips records={sent.chips} align="end" className="mb-1.5 w-full max-w-[92%] @lg:max-w-[80%]" />
      {(text || !hasContext(p.context)) && (
        <div
          data-find-event={event}
          className={`max-w-[92%] rounded-[22px] rounded-tr-lg px-4 py-2.5 text-[14.5px] leading-[1.55] break-words whitespace-pre-wrap @lg:max-w-[80%] ${
            p.dropped ? 'border border-dashed border-line-strong' : 'bg-bubble'
          }`}
        >
          {fold ? <Folded opens={found}>{body}</Folded> : body}
          {long && (
            <button type="button" data-find-skip onClick={() => setMore((m) => !m)} className="mt-1 block text-[12px] font-medium text-fg-3 underline underline-offset-2">
              {more ? 'Show less' : 'Show all'}
            </button>
          )}
          {p.items?.length ? (
            <div data-find-skip>
              <PRWakeList items={p.items} more={p.more} />
            </div>
          ) : null}
        </div>
      )}
      <ClippedNote event={event} clipped={clipped} className="mt-1 justify-end" />
      <CopyMsg text={text} align="end" />
    </div>
  );
}

/**
 * How a turn ended, as a quiet divider: one glyph and one sentence-case line, the phone's Outcome words. `limit` is the
 * thread's limit line (limits.ts `limitLabel`) on the turn the usage limit stopped.
 */
function ResultLine({ p, limit, code = true }: { p: ResultP; limit?: string | null; code?: boolean }) {
  const took = p.duration_ms != null ? duration(p.duration_ms) : null;
  const bad = !p.ok && !p.stopped;
  const glyph = limit ? 'limited' : p.ok ? 'done' : p.stopped ? 'settled' : 'failed';
  const [word, after] = p.ok ? ['Done', 'Done in'] : p.stopped ? ['Stopped', 'Stopped after'] : ['Failed', 'Failed after'];
  const bits = [limit ?? (took ? `${after} ${took}` : word)];
  // Turns, model and tokens tell a reader outside a code project nothing: Show technical details brings them back.
  if (code && p.turns) bits.push(plural(p.turns, 'turn'));
  if (code && p.model) bits.push(p.model);
  if (code && p.input_tokens != null) bits.push(`${p.input_tokens} in / ${p.output_tokens ?? 0} out`);
  if (bad && !limit && p.subtype && p.subtype !== 'success') bits.push(p.subtype.replace(/_/g, ' '));
  return (
    <div className="flex items-center gap-3 py-1 font-num text-[12px] font-medium text-fg-3">
      <div className="h-px flex-1 bg-line" />
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot status={glyph} size={8} />
        <span className="min-w-0">{bits.join(' · ')}</span>
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

/** A run switch: a quiet divider like the result line, with the handover's progress under it. The phone shows it too. */
export function SwitchLine({ it, running }: { it: SwitchItem; running: boolean }) {
  const note = handoverNote(it.p, it.done, it.superseded);
  const waiting = it.p.mode === 'handover' && !it.done && !it.superseded && running;
  return (
    <div className="py-1 text-center text-[12px] font-medium text-fg-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        {/* Inline, so a line that wraps on a phone keeps its icon on the first line. */}
        <span className="min-w-0 break-words text-fg-3">
          <Icon name="refresh" size={12} className="mr-1.5 inline-block align-[-1px]" />
          {switchText(it.p)}
          {waiting && <Loader size={11} className="ml-1.5 inline-block align-[-1px]" />}
        </span>
        <div className="h-px flex-1 bg-line" />
      </div>
      {note && <div className="mt-1 px-6 font-normal">{note}</div>}
    </div>
  );
}

/**
 * An agent joined or left a group thread (ADR 0019), or Ben committed a remote-led thread's changes (ADR 0020): a
 * quiet line, with the agent's avatar or a commit mark.
 */
export function MemberLine({ p }: { p: MemberP }) {
  const look = useAgent(p.agent || null) ?? { id: p.agent, name: p.name };
  return (
    <div data-member-line={p.event} className="flex items-center gap-3 py-1 text-[12px] font-medium text-fg-3">
      <div className="h-px flex-1 bg-line" />
      <span className="inline-flex min-w-0 items-center gap-1.5" title={p.commit?.sha ? p.commit.sha.slice(0, 12) : undefined}>
        {p.event === 'committed' ? <Icon name="check" size={13} className="shrink-0" /> : <AgentAvatar agent={{ ...look, name: p.name }} size={16} />}
        <span className="min-w-0 break-words">{memberLine(p)}</span>
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Mod log lines: dim system rows, each with the plugin that wrote it, in the status line's quiet style. */
function ModLog({ lines }: { lines: ModLine[] }) {
  return (
    <div className="space-y-0.5 text-[12px] leading-[1.5] text-fg-3">
      {lines.map((l) => (
        <div key={l.key} className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-[11px] text-fg-3">{l.plugin}</span>
          <span className="min-w-0 break-words whitespace-pre-wrap">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function ErrorCallout({ text, event }: { text: string; event: number }) {
  return (
    <div className="rounded-[20px] bg-surface px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
        <StatusDot status="needs" size={9} /> Error
      </div>
      <pre data-find-event={event} className="scroll-thin max-h-72 overflow-auto font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap break-words text-fg-2">
        {text}
      </pre>
    </div>
  );
}

function ReportCard({ p, event }: { p: ReportP; event: number }) {
  return (
    <div data-find-event={event} className={`overflow-hidden rounded-[22px] bg-surface ${p.dropped ? 'opacity-60' : ''}`}>
      <div data-find-skip className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3 text-[12.5px]">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-bg text-fg-3">
          <Icon name="inbox" size={14} />
        </span>
        <span className="font-medium">Report from {p.role ?? 'crew'}</span>
        {p.remote && <RemoteMark host={p.harness_name ?? p.harness} />}
        {p.dropped && (
          <span className="text-[11.5px] font-medium text-fg-3" title={p.undelivered ?? 'The run ended before the agent read this report'}>
            Not delivered
          </span>
        )}
        {p.task_id && <span className="font-mono text-[11.5px] text-fg-3">{p.task_id}</span>}
        {p.channel && (
          <a href={href.channel(p.channel)} className="text-fg-3 hover:text-fg">
            #{p.channel}
          </a>
        )}
        <span className="ml-auto flex items-center gap-2">
          {p.status && <StatusPill status={p.status} />}
          <a href={href.thread(p.thread_id)} className="press inline-flex h-7 items-center gap-1 rounded-full bg-bg px-3 font-medium text-fg shadow-[var(--shadow-card)]">
            Open thread <Icon name="arrowRight" size={12} />
          </a>
        </span>
      </div>
      {p.title && <div className="px-4 pt-3 font-display text-[15px] text-fg">{p.title}</div>}
      <div className="px-4 pt-2 pb-4">
        <ReportBody r={p} event={event} />
      </div>
    </div>
  );
}

// ---------- transcript ----------

interface ItemRowProps {
  it: Item;
  threadId: string;
  cwd?: string | null;
  running: boolean;
  /** The team card's members, on the first item when it is the thread's first message. */
  team?: Branch[];
  /** Work threads a seated agent opened from this row. */
  seated?: Thread[];
  /** The first item is the brief the delegating thread sent: it folds. */
  brief?: boolean;
  reports: Map<string, string>;
  byId: Map<string, Thread>;
  artifacts: Artifact[];
  /** The published pages whose card goes under this group. */
  pages?: Published[];
  /** A finished turn's steps, folded, on its first group of calls. */
  steps?: StepsView;
  /** The thread's limit line, on the last result when the usage limit stopped that turn. */
  limit?: string | null;
  /** On a result: it names its turns, model and tokens (Show technical details, or a repo channel). */
  code?: boolean;
  /** Reports shown in place from the threads on this group's delegation cards, by thread (`shownAnswers`). */
  answers?: Record<string, ReportP>;
  /** A report row whose answer shows on its thread's delegation card instead. */
  onCard?: boolean;
  /** Not one of the newest rows: it skips rendering while out of view (`.tx-row`). */
  defer?: boolean;
  /** An agent's reply in a thread with an agent: it sits in under its author line (REPLY_INDENT). */
  indent?: boolean;
}

/**
 * One item and the cards that go with it. Unchanged items keep their object across folds (`keepSame`), so a row
 * whose props are the same skips rendering when the stream brings new rows (#411). `pages` and `steps` are rebuilt
 * on every fold and compare by value.
 */
const ItemRow = memo(
  function ItemRow({ it, threadId, cwd, running, team, seated, brief, reports, byId, artifacts, pages, steps, limit, code, answers, onCard, defer, indent }: ItemRowProps) {
    const body = ((): ReactNode => {
      switch (it.type) {
        case 'user': {
          const bubble = <UserBubble key={it.key} p={it.p} at={it.at} threadId={threadId} event={it.key} clipped={it.clipped} fold={brief} lazy={defer} from={it.agent} />;
          return team ? [bubble, <DelegationCard key="team" branches={team} team reports={reports} />] : bubble;
        }
        case 'text':
          return (
            <div key={it.key} className="group/msg flex flex-col">
              <div data-find-event={it.key}>
                <Markdown text={it.p.text ?? ''} />
              </div>
              <ClippedNote event={it.key} clipped={it.clipped} />
              <CopyMsg text={it.p.text ?? ''} />
            </div>
          );
        case 'tools': {
          const { agents } = splitGroup(it.calls);
          const cards = [
            // Pages html_render showed, right under the call, before the reply.
            ...flatten(it.calls).flatMap((c) => {
              const r = renderedFrom(c.name, c.input, c.result);
              const a = r && artifacts.find((x) => x.id === r.artifact);
              return a ? [<HtmlRender key={`r${c.id}`} a={a} title={r.title} />] : [];
            }),
            ...delegations(it.calls).map((d) => (
              <DelegationCard key={`d${d.key}`} lead={d.lead && withLive(d.lead, byId)} branches={d.branches.map((b) => withLive(b, byId))} reports={reports} answers={answers} />
            )),
            ...(pages ?? []).map((p) => <PublishedCard key={`p${p.url}`} p={p} threadId={threadId} artifact={artifacts.findLast((a) => a.url === p.url)} />),
          ];
          // The calls themselves live under the turn's steps (StepsCard), not here: a group shows what it made.
          const subagents = agents.length ? (
            <DelegationCard key={`a${it.key}`} agents={agents.map((c) => <AgentRow key={c.id} c={c} cwd={cwd} running={running} />)} />
          ) : null;
          // Outside connectors stay in sight in the transcript, as Claude's apps show them: one row per app per group.
          const apps = connectorGroups(it.calls);
          const connectors = apps.length ? (
            <div key={`k${it.key}`} className="space-y-0.5">
              {apps.map((g) => (
                <ConnectorRow key={g.connector.id} g={g} cwd={cwd} running={running} />
              ))}
            </div>
          ) : null;
          const out = [connectors, subagents, ...cards].filter(Boolean);
          return steps ? [<StepsCard key="steps" v={steps} cwd={cwd} byId={byId} />, ...out] : out;
        }
        case 'result':
          return <ResultLine key={it.key} p={it.p} limit={limit} code={code !== false} />;
        case 'error':
          return <ErrorCallout key={it.key} event={it.key} text={it.p.text ?? ''} />;
        case 'report':
          return onCard ? null : <ReportCard key={it.key} event={it.key} p={it.p} />;
        case 'mod':
          return <ModLog key={it.key} lines={it.lines} />;
        case 'cloud':
          return <CloudAgentCard key={it.key} p={it.p} />;
        case 'switch':
          return <SwitchLine key={it.key} it={it} running={running} />;
        case 'question':
          return <QuestionCard key={it.key} threadId={threadId} q={it.q} />;
        case 'member':
          return <MemberLine key={it.key} p={it.p} />;
        case 'collision':
          return <CollisionFlag key={it.key} c={it.c} threadId={threadId} />;
        case 'merge_risk':
          return <MergeRiskCard key={it.key} p={it.p} />;
        case 'ask':
          return <AskItem key={it.key} p={it.p} byId={byId} reports={reports} answer={answers?.[it.p.thread_id]} />;
        default:
          return null;
      }
    })();
    const shown = Array.isArray(body) ? body.length > 0 : !!body;
    // data-key: the row useScrollAnchor keeps in place and a search hit scrolls to.
    return shown || seated?.length ? (
      <div data-key={it.key} className={`${defer ? 'tx-row ' : ''}space-y-4${indent ? ` ${REPLY_INDENT}` : ''}`}>
        {body}
        {seated?.length ? <DelegationCard branches={seated.map(branchOf)} reports={reports} /> : null}
      </div>
    ) : null;
  },
  (a, b) => {
    for (const k of Object.keys(b) as (keyof ItemRowProps)[]) {
      if (k === 'pages' || k === 'steps' || k === 'answers' || k === 'seated' ? !same(a[k], b[k]) : a[k] !== b[k]) return false;
    }
    return Object.keys(a).length === Object.keys(b).length;
  },
);


/**
 * The heads of the replies being written, which alone show live eyes (ADR 0021, D11), with what each shows. A thread
 * of one agent: while it runs, the head of the run of replies the transcript ends on (back from the last row, past
 * the rows that do not part a run). A group thread: each agent that works or waits on Ben shows its own state on its
 * latest head, unless a message to it came after (its new reply has no head yet).
 */
function liveHeads(items: readonly Item[], heads: ReadonlyMap<number, string>, o: { running: boolean; lead: string | null; seats: Seats; mark: Mark }): Map<number, FaceShows> {
  const out = new Map<number, FaceShows>();
  if (o.seats?.length) {
    const busy = new Map(o.seats.filter((s) => s.state === 'working' || s.state === 'needs').map((s) => [s.agent, s.state]));
    const decided = new Set<string>();
    for (let i = items.length - 1; i >= 0 && decided.size < busy.size; i--) {
      const it = items[i];
      if (it.type === 'user') for (const a of it.p.to?.length ? it.p.to : o.lead ? [o.lead] : []) if (busy.has(a)) decided.add(a);
      const agent = heads.get(it.key);
      if (!agent || !busy.has(agent) || decided.has(agent)) continue;
      out.set(it.key, { member: busy.get(agent)! });
      decided.add(agent);
    }
    return out;
  }
  if (!o.running) return out;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === 'mod' || it.type === 'result' || it.type === 'merge_risk' || (it.type === 'user' && it.p.source === 'lead')) continue;
    if (!isReply(it)) break;
    if (heads.has(it.key)) {
      out.set(it.key, { mark: o.mark });
      break;
    }
  }
  return out;
}

type Seats = readonly Pick<ThreadMember, 'agent' | 'lead' | 'harness' | 'model' | 'state'>[] | undefined;

export const Transcript = memo(function Transcript({
  threadId,
  events,
  running,
  cwd,
  known = NO_THREADS,
  team,
  artifacts = NO_ARTIFACTS,
  reports = NO_REPORTS,
  history = null,
  delegated = false,
  limit = null,
  elsewhere = false,
  code = true,
  lead = null,
  harness,
  model,
  channelId,
  seats,
  mark = 'working',
}: {
  threadId: string;
  /** The thread's channel, which a remote agent's lock line names and links (ADR 0020). */
  channelId?: string;
  /** The agent the thread runs as: its replies carry its author line, and rows from before Omni recorded one read as its. */
  lead?: string | null;
  /** The thread's run now, for the author line's harness and model on replies after its last switch. */
  harness?: string;
  model?: string | null;
  /** The thread's seated agents (`thread.members`): a member's author line names its own run and shows its own state, not the lead's. */
  seats?: Seats;
  /** The thread's status mark, as the header's pill draws it: the head of the reply being written shows it (ADR 0021, D11). */
  mark?: Mark;
  /** Results name their turns, model and tokens: Show technical details is on, or the channel has a repo. */
  code?: boolean;
  /** Every row held, anchors included. */
  events: EventRow[];
  running: boolean;
  cwd?: string | null;
  /** Threads this one started, and their team members: delegation cards read their live state from here. */
  known?: Thread[];
  /** A team lead's members, shown as a card under its brief. */
  team?: Branch[];
  /** The thread's files: a published page's card previews the one linked to its url. */
  artifacts?: Artifact[];
  /** Where each crew report the agent has not read is, by the thread that reported (`reportNotes`). */
  reports?: Map<string, string>;
  /** The spans `events` holds whole and the loads on them; null shows `events` as the whole thread. */
  history?: ThreadHistory | null;
  /** Another thread started this one: its first message is that thread's brief. */
  delegated?: boolean;
  /** The thread's limit line (limits.ts `limitLabel`) while a usage limit holds it: the last result says it. */
  limit?: string | null;
  /** Another Mac holds the thread and runs its process, so this server's live task list knows nothing of it. */
  elsewhere?: boolean;
}) {
  const byId = useMemo(() => new Map(known.map((t) => [t.id, t])), [known]);
  const spans = history?.history.spans;
  // The last fold's items, whose unchanged ones the next fold keeps (`keepSame`).
  const held = useRef<Item[]>([]);
  const all = useMemo(() => {
    held.current = keepSame(held.current, buildItems(events, spans).items);
    return held.current;
  }, [events, spans]);
  const seated = useMemo(() => {
    if (!known.some((t) => t.seated_delegation?.thread_id === threadId)) return new Map<number, Thread[]>();
    const onCards = new Set(all.flatMap((it) => it.type === 'tools'
      ? delegations(it.calls).flatMap((d) => [d.lead?.id, ...d.branches.map((b) => b.id)])
      : it.type === 'ask' ? [it.p.thread_id] : []));
    return seatedDelegationsAt(known.filter((t) => t.seated_delegation?.thread_id === threadId && !onCards.has(t.id)), all, events, spans);
  }, [known, threadId, all, events, spans]);
  // A message several agents answered gathers their replies into lanes (ADR 0019, @omni/shared/lanes.ts). `items` is
  // the flow outside the lanes, which the author lines and the turns' steps read; each lane folds its own.
  const flow = useMemo<LaneFolded[]>(() => laneFold(all, { lead, cwd }), [all, lead, cwd]);
  const items = useMemo(() => (flow.some((x) => x.type === 'lanes') ? flow.filter((x): x is Item => x.type !== 'lanes') : all), [flow, all]);
  // The turns' boundaries: lanes whose agents have all finished end their turn as a result does.
  const turnItems = useMemo(
    () => (flow.some((x) => x.type === 'lanes') ? flow.flatMap((x): Item[] => (x.type !== 'lanes' ? [x] : lanesEnded(x) ? [{ type: 'result', key: x.key + 0.5, p: { ok: true, subtype: 'success', turns: 1 } }] : [])) : all),
    [flow, all],
  );
  // The lanes are still running: they show their own steps and latest line, not the transcript's live ones.
  const lanesLive = useMemo(() => {
    const at = flow.findLast((x) => x.type !== 'mod' && x.type !== 'collision' && x.type !== 'merge_risk');
    return at?.type === 'lanes' && !lanesEnded(at);
  }, [flow]);
  const edges = useMemo(() => (spans ? historyEdges({ spans }, items.map((it) => it.key)) : null), [spans, items]);
  // The first item is the thread's first message only when the start is held.
  const fromStart = !spans || atStart({ spans });
  const pages = useMemo(() => publishedByGroup(all), [all]);
  const answers = useMemo(() => shownAnswers(all), [all]);
  const { tasks: live, feedLive } = useApp();
  const stored = useMemo(() => buildTasks(events), [events]);
  const tasks = useMemo(() => mergeTasks(stored, live, threadId, { feedLive, here: !elsewhere }), [stored, live, feedLive, threadId, elsewhere]);
  const latestStatus = useMemo(() => (running ? statusLabel(events) : null), [events, running]);
  const since = useMemo(() => (running ? turnStart(events) : null), [events, running]);
  const phase = useMemo(() => (running ? turnPhase(events) : 'working'), [events, running]);

  // Who wrote each run of replies: an author line over its first item (ADR 0019).
  const heads = useMemo(() => replyHeads(items, lead), [items, lead]);
  // The run each head's reply came from: before the first switch, the run it moved from; after one, the run it moved to.
  const run = useMemo<ReplyRun | null>(() => (harness ? { harness, model } : null), [harness, model]);
  const runs = useMemo(() => {
    const out = new Map<number, ReplyRun | null>();
    if (!heads.size) return out;
    const first = items.find((it): it is SwitchItem => it.type === 'switch');
    let now: ReplyRun | null = first ? { harness: first.p.from.harness, model: first.p.from.modelLabel } : run;
    for (const it of items) {
      if (it.type === 'switch') now = { harness: it.p.to.harness, model: it.p.to.modelLabel };
      if (heads.has(it.key)) out.set(it.key, seatRun(seats, heads.get(it.key)) ?? now);
    }
    return out;
  }, [items, heads, run, seats]);
  const leadLook = useAgent(lead);
  const { crew: agents, channel } = useApp();
  // Where each run of a remote agent's replies ends: a lock line, since it could not read the thread's files. A channel
  // open to remote agents lets them read, so it draws none.
  const readsOpen = remoteReadsOpen(channelId ? channel(channelId) : null);
  const tails = useMemo(() => (channelId && !readsOpen ? replyTails(items, lead, (id) => !!agents.find((a) => a.id === id)?.server) : new Map<number, string>()), [items, lead, agents, channelId, readsOpen]);
  // Replies in #conductor use the author's agent avatar. The saved channel look can still stand in elsewhere.
  const conductorChannel = channelId === CONDUCTOR_CHANNEL ? undefined : channel(CONDUCTOR_CHANNEL);
  const faceOf = (look: AgentLook) => {
    const c = conductorChannelLook(look, conductorChannel);
    return c ? <Avatar name={c.name} omni channelIcon={c.icon} avatarBg={c.avatar_bg} size={24} /> : undefined;
  };

  // Mod log lines and merge-risk cards are asides: the row before them is still the live one.
  const lastIdx = items.findLastIndex((it) => it.type !== 'mod' && it.type !== 'merge_risk');
  const last = items[lastIdx];
  // The turn is waiting on Ben's answer, not working: the card under it says so.
  const asking = last?.type === 'question' && last.q.state === 'pending';

  // Each turn's steps: a finished turn's fold onto its first group of calls, the running one's sit under the transcript.
  const { folded, liveSteps } = useMemo(() => {
    const turns = turnsOf(turnItems);
    const folded = new Map<number, StepsView>();
    let liveSteps: StepsView | null = null;
    turns.forEach((turn, k) => {
      const v = turnSteps(turn, { live: running && k === turns.length - 1, asking, status: latestStatus });
      if (!showsSteps(v)) return;
      if (v.live) liveSteps = v;
      else {
        const first = turn.find((it) => it.type === 'tools');
        if (first) folded.set(first.key, v);
      }
    });
    return { folded, liveSteps: liveSteps as StepsView | null };
  }, [turnItems, running, asking, latestStatus]);

  // A turn that runs with no reply of the lead's open yet (Ben just wrote): its live steps and thinking line get a head.
  const liveHead = running && !!leadLook && (() => {
    const at = items.findLastIndex((it) => it.type !== 'mod' && it.type !== 'result' && it.type !== 'merge_risk');
    const it = items[at];
    return !it || !isReply(it) || (it.agent ?? lead) !== lead;
  })();
  // The heads of the replies being written, which alone show live eyes; every other head is history and stays idle (D11).
  // A run with no head of its own yet (the live head below, or the lanes) leaves every head above it to history.
  const tailWritten = running && !liveHead && !lanesLive;
  const writing = useMemo(() => liveHeads(items, heads, { running: tailWritten, lead, seats, mark }), [items, heads, tailWritten, lead, seats, mark]);
  const author = (key: number) => {
    const id = heads.get(key);
    if (!id) return null;
    const it = items.find((x) => x.key === key);
    const look = agents.find((a) => a.id === id) ?? (id === lead ? leadLook : null) ?? { id, name: id };
    return (
      <div key={`h${key}`} className="mb-2">
        <AuthorLine agent={look} at={it && isReply(it) ? replyAt(it) : null} run={runs.get(key)} face={faceOf(look)} shows={writing.get(key)} />
      </div>
    );
  };

  // One lane's rows, drawn as the transcript draws them, with its steps on its first calls.
  const laneItems: LaneItems = (its, steps) => {
    if (!its.length) return steps ? <StepsCard key="lane-steps" v={steps} cwd={cwd} byId={byId} /> : null;
    const first = its.find((x) => x.type === 'tools')?.key;
    return its.map((it) => (
      <ItemRow
        key={it.key}
        it={it}
        threadId={threadId}
        cwd={cwd}
        running={running}
        reports={reports}
        byId={byId}
        artifacts={artifacts}
        pages={pages.get(it.key)}
        seated={seated.get(it.key)}
        steps={steps && it.key === first ? steps : undefined}
        code={it.type === 'result' ? code : undefined}
        answers={it.type === 'tools' ? answersFor(it.calls, answers) : undefined}
      />
    ));
  };

  const edgeRow = (key: number) => {
    const edge = edges?.get(key);
    return edge && history ? <HistoryEdgeRow key={edge.type === 'earlier' ? 'earlier' : `gap:${edge.after}`} edge={edge} history={history} /> : null;
  };

  return (
    <HistoryCtx.Provider value={history}>
      <TaskCtx.Provider value={tasks}>
        <div className="space-y-4">
          {!fromStart && team?.length ? <DelegationCard key="team" branches={team} team reports={reports} /> : null}
          {flow.flatMap((it, idx) => it.type === 'lanes' ? [<LanesBlock key={`lanes${it.key}`} block={it} threadId={threadId} render={laneItems} />] : [
            edgeRow(it.key),
            author(it.key),
            <ItemRow
              key={it.key}
              it={it}
              threadId={threadId}
              cwd={cwd}
              running={running}
              team={idx === 0 && fromStart && team?.length ? team : undefined}
              seated={seated.get(it.key)}
              brief={idx === 0 && fromStart && delegated}
              reports={reports}
              byId={byId}
              artifacts={artifacts}
              pages={pages.get(it.key)}
              steps={folded.get(it.key)}
              limit={idx === lastIdx && it.type === 'result' ? limit : undefined}
              code={it.type === 'result' ? code : undefined}
              answers={it.type === 'tools' ? answersFor(it.calls, answers) : it.type === 'ask' && answers.has(it.p.thread_id) ? { [it.p.thread_id]: answers.get(it.p.thread_id)! } : undefined}
              onCard={it.type === 'report' && it.p.shown && answers.has(it.p.thread_id)}
              defer={defers(idx, flow.length, LIVE_ROWS)}
              indent={!!lead && isReply(it)}
            />,
            tails.has(it.key) && channelId ? <RemoteLockLine key={`lock${it.key}`} channelId={channelId} className={REPLY_INDENT} /> : null,
          ])}
          {edgeRow(-1)}
          {!lanesLive && liveHead && leadLook && (liveSteps || !asking) && (
            <div key="live-head" className="mb-2">
              <AuthorLine agent={leadLook} run={run} face={faceOf(leadLook)} shows={agentShows(seats, leadLook.id, mark)} />
            </div>
          )}
          {!lanesLive && liveSteps && (
            <div className={lead ? REPLY_INDENT : undefined}>
              <StepsCard key="live-steps" v={liveSteps} cwd={cwd} byId={byId} />
            </div>
          )}
          {running && !asking && !lanesLive && (
            <div className={lead ? REPLY_INDENT : undefined}>
              <ThinkingLine label={latestStatus ?? (phase === 'starting' ? PHASE.starting.label : 'Thinking')} since={since} phase={phase} />
            </div>
          )}
        </div>
      </TaskCtx.Provider>
    </HistoryCtx.Provider>
  );
});
