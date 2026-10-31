import { Fragment, memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Artifact, type EventRow, type Thread } from '../api.ts';
import { clock, duration, plural, toDate } from '../format.ts';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';
import { DelegationCard } from './Delegation.tsx';
import { PublishedCard } from './Published.tsx';
import { CloudAgentCard } from './thread/CloudAgentCard.tsx';
import { PRWakeList } from './thread/PRWatch.tsx';
import { ClippedNote, HistoryCtx, HistoryEdgeRow } from './thread/HistoryEdgeRow.tsx';
import { QuestionCard } from './thread/QuestionCard.tsx';
import { Markdown } from './Markdown.tsx';
import { CheckItem, copyText, Icon, Loader, StatusDot, StatusPill, Ticks } from './ui.tsx';
import { SOURCE_TAG } from '@omni/shared/slash-menu.ts';
import { slashPieces } from '@omni/shared/slash-pills.ts';
import { statusLabel } from '../status-line.ts';
import type { SlashHit } from '@omni/shared/slash.ts';
import { publishedFrom, type Published } from '@omni/shared/published.ts';
import { handoverNote, switchText } from '@omni/shared/run-switch.ts';
import { ContextChips, hasContext } from '../message-context/ContextChips.tsx';
import { buildItems, buildTasks, keepSame, same, type FoldPlan, type Item, toolLabel, toolSummary, type ReportP, type ResultP, type Todo, type ModLine, type SwitchItem, type ToolCall, type UserP } from '../transcript/fold.ts';
import { delegations, splitGroup, withLive, type Branch } from '../transcript/delegation.ts';
import { atStart, historyEdges, type Clipped } from '@omni/shared/history.ts';
import type { ThreadHistory } from '../pages/useThreadHistory.ts';

import { AgentRow, countCalls, flatten, TaskCtx, ToolGroup } from './thread/ToolRows.tsx';
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

/** A small Copy control under a message, shown on hover or keyboard focus (always on touch). Copies the source text. */
function CopyMsg({ text, align = 'start' }: { text: string; align?: 'start' | 'end' }) {
  const [done, setDone] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      aria-label="Copy message"
      title="Copy message"
      onClick={async () => {
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className={`hov press mt-0.5 inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-fg-4 opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 hover:text-fg focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${align === 'end' ? 'self-end' : 'self-start'}`}
    >
      <Icon name={done ? 'check' : 'copy'} size={12} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function UserBubble({ p, at, threadId, event, clipped }: { p: UserP; at: string; threadId: string; event: number; clipped?: Clipped }) {
  const [more, setMore] = useState(false);
  // Where the pill whose description is open starts.
  const [about, setAbout] = useState<number | null>(null);
  const text = p.text ?? '';
  // A clipped message shows all it came with; Show all under it loads the rest.
  const long = !clipped && text.length > 1400;
  const cut = long && !more;
  const pieces = slashPieces(text, p.slash, cut ? 1200 : text.length);
  const open = pieces.find((x) => x.hit?.start === about)?.hit;
  const label = p.source ? SOURCE_LABEL[p.source] : undefined;
  const how = p.dropped ? null : p.mode === 'steer' ? 'Steered' : p.mode === 'interrupt' ? 'Interrupted and sent' : null;
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
        <span className="font-num text-[11px] text-fg-4">{clock(toDate(at))}</span>
      </div>
      {p.attachments?.length ? <Attachments threadId={threadId} items={p.attachments} /> : null}
      <ContextChips records={p.context} align="end" className="mb-1.5 w-full max-w-[92%] sm:max-w-[80%]" />
      {(text || !hasContext(p.context)) && (
        <div
          className={`max-w-[92%] rounded-[22px] rounded-tr-lg px-4 py-2.5 text-[14.5px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%] ${
            p.dropped ? 'border border-dashed border-line-strong' : 'bg-bubble'
          }`}
        >
          {pieces.map(({ text: t, hit }, i) =>
            hit ? (
              <CommandPill key={i} label={t} cmd={hit} open={hit === open} onToggle={() => setAbout((a) => (a === hit.start ? null : hit.start))} />
            ) : (
              <Fragment key={i}>{t}</Fragment>
            ),
          )}
          {cut && '...'}
          {open && (
            <span className="mt-1.5 block border-t border-line pt-1.5 text-[12.5px] leading-snug whitespace-normal text-fg-3">
              {open.description || 'No description'} <span className="text-fg-4">· {SOURCE_TAG[open.source]}</span>
            </span>
          )}
          {long && (
            <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 block text-[12px] font-medium text-fg-3 underline underline-offset-2">
              {more ? 'Show less' : 'Show all'}
            </button>
          )}
          {p.items?.length ? <PRWakeList items={p.items} more={p.more} /> : null}
        </div>
      )}
      <ClippedNote event={event} clipped={clipped} className="mt-1 justify-end" />
      <CopyMsg text={text} align="end" />
    </div>
  );
}

function ResultLine({ p }: { p: ResultP }) {
  const word = p.ok ? 'done' : p.stopped ? 'stopped' : 'ended';
  const bits = [p.duration_ms != null ? `${word} in ${duration(p.duration_ms)}` : word];
  if (p.turns) bits.push(plural(p.turns, 'turn'));
  const bad = !p.ok && !p.stopped;
  const tokens = p.input_tokens != null ? `${p.input_tokens} in / ${p.output_tokens ?? 0} out` : null;
  return (
    <div className="flex items-center gap-3 py-1 font-num text-[12px] font-medium text-fg-4">
      <div className="h-px flex-1 bg-line" />
      <span className={`flex items-center gap-2 ${bad ? 'text-fg-2' : ''}`}>
        {bad ? (
          <StatusDot status="needs" size={8} />
        ) : (
          <span className={`inline-block h-1 w-1 rounded-full ${p.ok ? 'bg-done shadow-[inset_0_0_0_0.5px_var(--done-edge)]' : 'bg-fg-4'}`} />
        )}
        {bits.join(' · ')}
        {p.model ? <span> · {p.model}</span> : null}
        {tokens ? <span> · {tokens}</span> : null}
        {bad && p.subtype && p.subtype !== 'success' ? ` · ${p.subtype.replace(/_/g, ' ')}` : ''}
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
    <div className="py-1 text-center text-[12px] font-medium text-fg-4">
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

/** Mod log lines: dim system rows, each with the plugin that wrote it, in the status line's quiet style. */
function ModLog({ lines }: { lines: ModLine[] }) {
  return (
    <div className="space-y-0.5 text-[12px] leading-[1.5] text-fg-4">
      {lines.map((l) => (
        <div key={l.key} className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-[11px] text-fg-3">{l.plugin}</span>
          <span className="min-w-0 break-words whitespace-pre-wrap">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function ErrorCallout({ text }: { text: string }) {
  return (
    <div className="rounded-[20px] bg-surface px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
        <StatusDot status="needs" size={9} /> Error
      </div>
      <pre className="scroll-thin max-h-72 overflow-auto font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap break-words text-fg-2">{text}</pre>
    </div>
  );
}

function ReportCard({ p }: { p: ReportP }) {
  return (
    <div className={`overflow-hidden rounded-[22px] bg-surface ${p.dropped ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3 text-[12.5px]">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-bg text-fg-3">
          <Icon name="inbox" size={14} />
        </span>
        <span className="font-medium">Report from {p.role ?? 'crew'}</span>
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
        <Markdown text={p.text || '(no reply)'} />
      </div>
    </div>
  );
}

/** The latest TodoWrite as a live checklist (Bencho "chk"). */
function PlanCard({ todos, threadId }: { todos: Todo[]; threadId: string }) {
  const [updating, setUpdating] = useState<number | null>(null);
  const done = todos.filter((t) => t.status === 'completed').length;
  const active = todos.find((t) => t.status === 'in_progress');

  const toggleTodo = async (index: number) => {
    const todo = todos[index];
    if (!todo || updating !== null) return;

    const newStatus =
      todo.status === 'completed' ? 'pending' : todo.status === 'pending' ? 'in_progress' : 'completed';

    setUpdating(index);
    try {
      await api.patch(`/threads/${encodeURIComponent(threadId)}/plan/steps/${index}`, { status: newStatus });
    } catch (err) {
      console.error('Failed to update plan step:', err);
    } finally {
      setUpdating(null);
    }
  };

  return (
    <section aria-label="Plan" className="rounded-[22px] bg-surface px-4 pt-3.5 pb-3">
      <div className="mb-2.5 flex items-center gap-3">
        <span className="caption">Plan</span>
        <Ticks value={todos.length ? done / todos.length : 0} count={Math.max(1, todos.length)} height={6} className="max-w-40 flex-1" label="Plan progress" />
        <span className="ml-auto font-num text-[11px] text-fg-3 tabular-nums">
          {done}/{todos.length}
        </span>
      </div>
      {todos.map((t, k) => (
        <CheckItem key={k} state={t.status ?? 'pending'} onClick={() => toggleTodo(k)}>
          {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
        </CheckItem>
      ))}
      {!active && done === todos.length && todos.length > 0 && <div className="mt-1.5 text-[12px] text-fg-4">All done</div>}
    </section>
  );
}

// ---------- transcript ----------

interface ItemRowProps {
  it: Item;
  threadId: string;
  cwd?: string | null;
  running: boolean;
  /** The newest item that is not a mod line. */
  isLast: boolean;
  /** The team card's members, on the first item when it is the thread's first message. */
  team?: Branch[];
  reports: Map<string, string>;
  byId: Map<string, Thread>;
  artifacts: Artifact[];
  /** The published pages whose card goes under this group. */
  pages?: Published[];
  /** The plan, on the group of the latest TodoWrite. */
  plan?: FoldPlan;
}

/**
 * One item and the cards that go with it. Unchanged items keep their object across folds (`keepSame`), so a row
 * whose props are the same skips rendering when the stream brings new rows (#411). `pages` and `plan` are rebuilt
 * on every fold and compare by value.
 */
const ItemRow = memo(
  function ItemRow({ it, threadId, cwd, running, isLast, team, reports, byId, artifacts, pages, plan }: ItemRowProps) {
    const body = ((): ReactNode => {
      switch (it.type) {
        case 'user': {
          const bubble = <UserBubble key={it.key} p={it.p} at={it.at} threadId={threadId} event={it.key} clipped={it.clipped} />;
          return team ? [bubble, <DelegationCard key="team" branches={team} team reports={reports} />] : bubble;
        }
        case 'text':
          return (
            <div key={it.key} className="group/msg flex flex-col">
              <Markdown text={it.p.text ?? ''} />
              <ClippedNote event={it.key} clipped={it.clipped} />
              <CopyMsg text={it.p.text ?? ''} />
            </div>
          );
        case 'tools': {
          const { agents, rest, agentsFirst } = splitGroup(it.calls);
          const cards = [
            ...delegations(it.calls).map((d) => (
              <DelegationCard key={`d${d.key}`} lead={d.lead && withLive(d.lead, byId)} branches={d.branches.map((b) => withLive(b, byId))} reports={reports} />
            )),
            ...(pages ?? []).map((p) => <PublishedCard key={`p${p.url}`} p={p} threadId={threadId} artifact={artifacts.findLast((a) => a.url === p.url)} />),
          ];
          const group = rest.length ? (
            <ToolGroup key={it.key} calls={rest} total={rest.length + rest.reduce((n, c) => n + countCalls(c), 0)} cwd={cwd} running={running} isLast={isLast} />
          ) : null;
          const subagents = agents.length ? (
            <DelegationCard key={`a${it.key}`} agents={agents.map((c) => <AgentRow key={c.id} c={c} cwd={cwd} running={running} />)} />
          ) : null;
          const out = [...(agentsFirst ? [subagents, group] : [group, subagents]), ...cards].filter(Boolean);
          // One keyed plan card that follows the latest TodoWrite, so ticks animate instead of remounting.
          return plan ? [...out, <PlanCard key="plan" todos={plan.todos} threadId={threadId} />] : out;
        }
        case 'result':
          return <ResultLine key={it.key} p={it.p} />;
        case 'error':
          return <ErrorCallout key={it.key} text={it.p.text ?? ''} />;
        case 'report':
          return <ReportCard key={it.key} p={it.p} />;
        case 'mod':
          return <ModLog key={it.key} lines={it.lines} />;
        case 'cloud':
          return <CloudAgentCard key={it.key} p={it.p} />;
        case 'switch':
          return <SwitchLine key={it.key} it={it} running={running} />;
        case 'question':
          return <QuestionCard key={it.key} threadId={threadId} q={it.q} />;
        default:
          return null;
      }
    })();
    const shown = Array.isArray(body) ? body.length > 0 : !!body;
    // data-key: the row useScrollAnchor keeps in place and a search hit scrolls to.
    return shown ? (
      <div data-key={it.key} className="space-y-4">
        {body}
      </div>
    ) : null;
  },
  (a, b) => {
    for (const k of Object.keys(b) as (keyof ItemRowProps)[]) {
      if (k === 'pages' || k === 'plan' ? !same(a[k], b[k]) : a[k] !== b[k]) return false;
    }
    return Object.keys(a).length === Object.keys(b).length;
  },
);


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
}: {
  threadId: string;
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
}) {
  const byId = useMemo(() => new Map(known.map((t) => [t.id, t])), [known]);
  const spans = history?.history.spans;
  // The last fold's items, whose unchanged ones the next fold keeps (`keepSame`).
  const held = useRef<Item[]>([]);
  const { items, plan } = useMemo(() => {
    const built = buildItems(events, spans);
    held.current = keepSame(held.current, built.items);
    return { items: held.current, plan: built.plan };
  }, [events, spans]);
  const edges = useMemo(() => (spans ? historyEdges({ spans }, items.map((it) => it.key)) : null), [spans, items]);
  // The first item is the thread's first message only when the start is held.
  const fromStart = !spans || atStart({ spans });
  const pages = useMemo(() => publishedByGroup(items), [items]);
  const { tasks: live, feedLive } = useApp();
  const stored = useMemo(() => buildTasks(events), [events]);
  // The server's live list wins: a task it no longer runs has ended, even if no end row was stored.
  const tasks = useMemo(() => {
    const mine = live.filter((t) => t.thread_id === threadId && t.tool_use_id);
    const out = new Map(stored);
    for (const [id, t] of out) {
      if (t.running && feedLive && !mine.some((m) => m.tool_use_id === id)) out.set(id, { ...t, running: false, status: t.status ?? 'stopped' });
    }
    for (const m of mine) {
      const prev = out.get(m.tool_use_id!);
      out.set(m.tool_use_id!, { running: true, background: m.background, tool_uses: m.tool_uses ?? prev?.tool_uses, started: prev?.started ?? m.started_at });
    }
    return out;
  }, [stored, live, feedLive, threadId]);
  const latestStatus = useMemo(() => (running ? statusLabel(events) : null), [events, running]);

  // Mod log lines are asides: the row before them is still the live one.
  const lastIdx = items.findLastIndex((it) => it.type !== 'mod');
  const last = items[lastIdx];
  const showWorking = running && (!last || last.type === 'user' || last.type === 'report' || last.type === 'text');
  // The turn is waiting on Ben's answer, not working: the card under it says so.
  const asking = last?.type === 'question' && last.q.state === 'pending';

  const edgeRow = (key: number) => {
    const edge = edges?.get(key);
    return edge && history ? <HistoryEdgeRow key={edge.type === 'earlier' ? 'earlier' : `gap:${edge.after}`} edge={edge} history={history} /> : null;
  };

  return (
    <HistoryCtx.Provider value={history}>
      <TaskCtx.Provider value={tasks}>
        <div className="space-y-4">
          {!fromStart && team?.length ? <DelegationCard key="team" branches={team} team reports={reports} /> : null}
          {items.flatMap((it, idx) => [
            edgeRow(it.key),
            <ItemRow
              key={it.key}
              it={it}
              threadId={threadId}
              cwd={cwd}
              running={running}
              isLast={idx === lastIdx}
              team={idx === 0 && fromStart && team?.length ? team : undefined}
              reports={reports}
              byId={byId}
              artifacts={artifacts}
              pages={pages.get(it.key)}
              plan={plan?.after === it.key ? plan : undefined}
            />,
          ])}
          {edgeRow(-1)}
          {(showWorking || latestStatus) && !asking && (
            <div className="flex items-center gap-2 text-[12.5px] text-fg-3">
              {running && <Loader size={13} />}
              <span className="truncate">{latestStatus ?? 'Working'}</span>
            </div>
          )}
        </div>
      </TaskCtx.Provider>
    </HistoryCtx.Provider>
  );
});
