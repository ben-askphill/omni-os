import { createContext, Fragment, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, errorText, uploadUrl, type Artifact, type Attachment, type EventRow, type PendingMsg, type Thread } from '../api.ts';
import { bytes, clock, duration, plural, toDate } from '../format.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { BranchFace, DelegationCard, RailItem, ROW_CARD } from './Delegation.tsx';
import { PublishedCard } from './Published.tsx';
import { Markdown } from './Markdown.tsx';
import { Button, CheckItem, copyText, Icon, IconButton, Loader, Modal, StatusDot, StatusPill, Ticks } from './ui.tsx';
import { isOmnis, isParked, parkedHeading, parkedLabel, parkedOf, requestIdFor } from '../requests.ts';
import { canMove, editBody, editFailed, isEditable, movedOrder, openEdit, reconcileEdits, STALE_NOTE, type EditDraft } from '../pending-edits.ts';
import { SOURCE_TAG } from '@omni/shared/slash-menu.ts';
import { slashPieces } from '@omni/shared/slash-pills.ts';
import { statusLabel } from '../status-line.ts';
import type { SlashHit } from '@omni/shared/slash.ts';
import { publishedFrom, type Published } from '@omni/shared/published.ts';
import {
  buildItems,
  buildTasks,
  str,
  type Item,
  toolLabel,
  toolSummary,
  type ReportP,
  type ResultP,
  type TaskView,
  type Todo,
  type ModLine,
  type ToolCall,
  type UserP,
} from '../transcript/fold.ts';
import { agentStatus, delegations, splitGroup, withLive, type Branch } from '../transcript/delegation.ts';

export { toolLabel, toolSummary, type ToolCall };

const NO_THREADS: Thread[] = [];
const NO_ARTIFACTS: Artifact[] = [];
const NO_REPORTS = new Map<string, string>();

/** Task state by the Agent call's tool_use id. */
const TaskCtx = createContext<Map<string, TaskView>>(new Map());

function toolIcon(name: string) {
  if (name === 'Bash' || name === 'BashOutput') return 'terminal' as const;
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep'].includes(name)) return 'file' as const;
  if (name === 'WebFetch' || name === 'WebSearch' || name.includes('browser')) return 'globe' as const;
  if (name === 'Task' || name === 'Agent') return 'layers' as const;
  return 'tool' as const;
}

// ---------- tool rows ----------

function Pre({ children, tone, className = '' }: { children: ReactNode; tone?: 'bad' | 'add' | 'del'; className?: string }) {
  const bg = tone === 'add' ? 'bg-[var(--diff-add)]' : tone === 'del' ? 'bg-[var(--diff-del)]' : 'bg-code';
  return (
    <pre
      className={`scroll-thin max-h-80 overflow-auto rounded-xl px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap break-words shadow-[inset_0_0_0_1px_var(--line)] ${bg} ${tone === 'bad' ? 'text-fg' : 'text-fg-2'} ${className}`}
    >
      {children}
    </pre>
  );
}

function ToolInput({ c }: { c: ToolCall }) {
  const i = c.input;
  if (c.name === 'Bash') {
    return (
      <>
        {str(i.description) && <div className="text-[12px] text-fg-3">{str(i.description)}</div>}
        <Pre>$ {str(i.command)}</Pre>
      </>
    );
  }
  if (c.name === 'Edit' || c.name === 'MultiEdit') {
    const edits = c.name === 'MultiEdit' && Array.isArray(i.edits) ? (i.edits as Record<string, unknown>[]) : [i];
    return (
      <>
        <div className="font-mono text-[11.5px] break-all text-fg-3">{str(i.file_path)}</div>
        {edits.slice(0, 8).map((ed, k) => (
          <div key={k} className="space-y-1">
            {str(ed.old_string) && <Pre tone="del">{str(ed.old_string)}</Pre>}
            <Pre tone="add">{str(ed.new_string)}</Pre>
          </div>
        ))}
      </>
    );
  }
  if (c.name === 'Write') {
    const content = str(i.content);
    const lines = content.split('\n');
    return (
      <>
        <div className="font-mono text-[11.5px] break-all text-fg-3">
          {str(i.file_path)} <span className="text-fg-4">({lines.length} lines)</span>
        </div>
        <Pre tone="add">{lines.slice(0, 80).join('\n')}{lines.length > 80 ? '\n...' : ''}</Pre>
      </>
    );
  }
  if (c.name === 'Task' || c.name === 'Agent') {
    return <Pre>{str(i.prompt)}</Pre>;
  }
  if (c.name === 'TodoWrite' && Array.isArray(i.todos)) {
    return (
      <div>
        {(i.todos as Todo[]).map((t, k) => (
          <CheckItem key={k} state={t.status ?? 'pending'}>
            {t.content}
          </CheckItem>
        ))}
      </div>
    );
  }
  const json = JSON.stringify(i, null, 2);
  if (!json || json === '{}') return null;
  return <Pre>{json.length > 6000 ? json.slice(0, 6000) + '\n...' : json}</Pre>;
}

// The CLI answers a tool it cut short with one of these texts: an interrupt, or a turn abort
// that skipped queued tools or dropped a running one. Not a failure.
const STOPPED_TOOL = [
  "The user doesn't want to proceed with this tool use",
  "The user doesn't want to take this action right now",
  '[Tool call skipped',
  '[Tool call did not complete',
  '[Request interrupted by user',
];
const interruptedTool = (c: ToolCall) => !!c.result?.is_error && STOPPED_TOOL.some((t) => c.result!.text.startsWith(t));

/** Time since a sub-agent started, ticking each second. */
function Elapsed({ since }: { since: string }) {
  const now = useNow(1000);
  return <>{duration(Math.max(0, now - toDate(since).getTime()))}</>;
}

const TASK_END: Record<string, string> = { completed: 'done', failed: 'failed', killed: 'stopped', stopped: 'stopped' };

/** Every call a sub-agent made, however deep. */
const countCalls = (c: ToolCall): number => c.children.reduce((n, ch) => n + 1 + countCalls(ch), 0);

/** A sub-agent's line on its Agent row: background or not, calls so far and time running, or how it ended. */
function TaskBadge({ t }: { t: TaskView }) {
  if (t.running) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 font-num text-[11px] text-live-text tabular-nums">
        {t.background && <span>background ·</span>}
        {t.tool_uses ? <span>{plural(t.tool_uses, 'tool')} ·</span> : null}
        <Elapsed since={t.started} />
        <Loader size={11} />
      </span>
    );
  }
  const end = TASK_END[t.status ?? ''] ?? t.status ?? 'done';
  const took = t.ended ? duration(toDate(t.ended).getTime() - toDate(t.started).getTime()) : '';
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-num text-[11px] text-fg-4 tabular-nums">
      {end === 'failed' && <StatusDot status="needs" size={7} />}
      <span className={end === 'failed' ? 'text-fg' : ''}>{end}</span>
      {took && <span>· {took}</span>}
    </span>
  );
}

function ToolRow({ c, cwd, running, depth = 0 }: { c: ToolCall; cwd?: string | null; running: boolean; depth?: number }) {
  const [open, setOpen] = useState(false);
  const task = useContext(TaskCtx).get(c.id);
  // A background agent's result comes back at launch, so its task says whether it still runs.
  const pending = task ? task.running : !c.result;
  const stopped = interruptedTool(c);
  const err = c.result?.is_error && !stopped;
  const summary = toolSummary(c, cwd);
  const mono = ['Bash', 'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep'].includes(c.name);
  const indent = depth > 0 || c.orphan;
  return (
    <div className={indent ? 'ml-3.5 border-l border-line pl-2.5' : ''}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hov group flex h-8 w-full min-w-0 items-center gap-2 rounded-full px-2.5 text-left text-[12.5px]"
      >
        <Icon name="chevronRight" size={12} className={`text-fg-4 transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-90' : ''}`} />
        <Icon name={toolIcon(c.name)} size={13} className="text-fg-3" />
        <span className={`shrink-0 font-medium text-fg-2`}>{toolLabel(c.name)}</span>
        <span className={`min-w-0 flex-1 truncate text-fg-3 ${mono ? 'font-mono text-[11.5px]' : ''}`}>{summary}</span>
        {c.children.length > 0 && !task?.running && <span className="shrink-0 font-num text-[11px] text-fg-4">{c.children.length} sub-calls</span>}
        {task ? (
          <TaskBadge t={task} />
        ) : pending && running ? (
          <Loader size={11} className="text-fg-3" />
        ) : err ? (
          <span className="inline-flex shrink-0 items-center gap-1 font-num text-[11px] text-fg">
            <StatusDot status="needs" size={7} /> error
          </span>
        ) : stopped ? (
          <span className="shrink-0 font-num text-[11px] text-fg-4">stopped</span>
        ) : null}
      </button>
      {open && (
        <div className="fade-in mt-1 mb-2.5 ml-7 space-y-1.5">
          <ToolInput c={c} />
          {c.result ? (
            <>
              <Pre tone={err ? 'bad' : undefined}>{c.result.text || '(no output)'}</Pre>
              {c.result.truncated && <div className="text-[11px] text-fg-4">Output truncated</div>}
            </>
          ) : (
            <div className="text-[11.5px] text-fg-4">{running ? 'Waiting for result' : 'No result recorded'}</div>
          )}
        </div>
      )}
      {c.children.length > 0 && (open || (pending && (running || !!task))) && (
        <div className="mb-1 ml-3">
          {(open ? c.children : c.children.slice(-3)).map((ch) => (
            <ToolRow key={ch.id} c={ch} cwd={cwd} running={running} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A sub-agent as a delegation card row. It has no thread to open, so it opens in place: its prompt, its
 * answer and the calls it made. While it runs its latest calls show under it.
 */
function AgentRow({ c, cwd, running }: { c: ToolCall; cwd?: string | null; running: boolean }) {
  const [open, setOpen] = useState(false);
  const task = useContext(TaskCtx).get(c.id);
  const stopped = interruptedTool(c);
  const status = agentStatus(c, task, running, stopped);
  const busy = status === 'running';
  const type = str(c.input.subagent_type);
  const calls = task?.tool_uses ?? countCalls(c);
  const err = c.result?.is_error && !stopped;
  return (
    <RailItem status={status}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={ROW_CARD}>
        <BranchFace role={type} title={str(c.input.description) || 'Sub-agent'} status={status}>
          <span>{type || 'agent'}</span>
          {(task?.background || c.input.run_in_background === true) && <span>background</span>}
          {calls > 0 && <span className="font-num">{plural(calls, 'tool')}</span>}
          {task && (
            <span className="font-num text-fg-4 tabular-nums">
              {busy ? <Elapsed since={task.started} /> : task.ended ? duration(toDate(task.ended).getTime() - toDate(task.started).getTime()) : null}
            </span>
          )}
          <Icon name="chevronRight" size={11} className={`text-fg-4 transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-90' : ''}`} />
        </BranchFace>
      </button>
      {open && (
        <div className="fade-in mt-2 space-y-1.5 px-1">
          <ToolInput c={c} />
          {c.result ? <Pre tone={err ? 'bad' : undefined}>{c.result.text || '(no output)'}</Pre> : null}
        </div>
      )}
      {c.children.length > 0 && (open || busy) && (
        <div className="mt-1">
          {(open ? c.children : c.children.slice(-3)).map((ch) => (
            <ToolRow key={ch.id} c={ch} cwd={cwd} running={running} depth={1} />
          ))}
        </div>
      )}
    </RailItem>
  );
}

function countNames(calls: ToolCall[]) {
  const m = new Map<string, number>();
  const walk = (cs: ToolCall[]) =>
    cs.forEach((c) => {
      const n = toolLabel(c.name).split(' · ')[0];
      m.set(n, (m.get(n) ?? 0) + 1);
      walk(c.children);
    });
  walk(calls);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function flatten(calls: ToolCall[]): ToolCall[] {
  return calls.flatMap((c) => [c, ...flatten(c.children)]);
}

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

function ToolGroup({ calls, total, cwd, running, isLast }: { calls: ToolCall[]; total: number; cwd?: string | null; running: boolean; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  if (total === 1 && calls.length === 1) {
    return <ToolRow c={calls[0]} cwd={cwd} running={running} />;
  }
  const all = flatten(calls);
  const errors = all.filter((c) => c.result?.is_error && !interruptedTool(c)).length;
  const live = running && isLast && all.some((c) => !c.result);
  const latest = all[all.length - 1];
  const names = countNames(calls);
  return (
    <div className="rounded-[20px] bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hov flex h-10 w-full min-w-0 items-center gap-2 rounded-[20px] px-3.5 text-left text-[12.5px]"
      >
        <Icon name="chevronRight" size={12} className={`text-fg-4 transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-90' : ''}`} />
        <Icon name="tool" size={13} className="text-fg-3" />
        <span className="shrink-0 font-medium text-fg-2">
          <span className="font-num">{total}</span> tool calls
        </span>
        <span className="min-w-0 flex-1 truncate text-fg-3">
          {live && latest ? (
            <span className="font-mono text-[11.5px]">
              {toolLabel(latest.name)} {toolSummary(latest, cwd)}
            </span>
          ) : (
            names
              .slice(0, 4)
              .map(([n, k]) => (k > 1 ? `${n} ${k}` : n))
              .join(', ')
          )}
        </span>
        {errors > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 font-num text-[11px] text-fg">
            <StatusDot status="needs" size={7} /> {errors} failed
          </span>
        )}
        {live && <Loader size={11} className="text-fg-3" />}
      </button>
      {open && (
        <div className="fade-in px-1.5 pb-1.5">
          {calls.map((c) => (
            <ToolRow key={c.id} c={c} cwd={cwd} running={running} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- other items ----------

/** What Ben attached to a message: images as thumbnails that open full size, everything else as a download. */
export function Attachments({ threadId, items }: { threadId: string; items: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  if (!items.length) return null;
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {items.map((a) =>
        a.image ? (
          <button key={a.name} type="button" onClick={() => setOpen(a)} className="press overflow-hidden rounded-2xl bg-surface p-1" title={`${a.name} · ${bytes(a.size)}`}>
            <img src={uploadUrl(threadId, a)} alt={a.name} loading="lazy" className="max-h-44 w-auto max-w-[14rem] rounded-xl object-cover shadow-[inset_0_0_0_1px_var(--line)]" />
          </button>
        ) : (
          <a
            key={a.name}
            href={uploadUrl(threadId, a, true)}
            download={a.name}
            className="hov flex h-11 max-w-[16rem] items-center gap-2 rounded-2xl bg-surface px-2 text-[12.5px] [--hov:var(--surface-2)]"
            title={`${a.name} · ${bytes(a.size)}`}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg text-fg-3">
              <Icon name="file" size={15} />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-medium text-fg-2">{a.name}</span>
              <span className="block font-num text-[10.5px] text-fg-4">{bytes(a.size)}</span>
            </span>
            <Icon name="download" size={14} className="text-fg-3" />
          </a>
        ),
      )}
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        title={
          open && (
            <span className="flex items-center gap-2">
              <span className="truncate">{open.name}</span>
              <span className="font-num text-[11px] text-fg-3">{bytes(open.size)}</span>
            </span>
          )
        }
      >
        {open && (
          <div className="bg-surface-2">
            <img src={uploadUrl(threadId, open)} alt={open.name} className="mx-auto max-h-[78vh] w-auto" />
          </div>
        )}
      </Modal>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  conductor: 'from Conductor',
  team: 'Team',
  automation: 'Automation',
  capture: 'Captured',
  import: 'Imported',
  limit: 'After the usage limit',
};

/** A message that waits for the thread's worktree (SetupCard). */
const SETUP_LABEL = 'Sends once the worktree is ready';

function pendingLabel(m: PendingMsg, lead: boolean) {
  if (m.state === 'waiting') return 'Waiting for a free slot';
  if (m.state === 'held') return 'Queued, runs after this turn';
  if (lead) return 'Sent, starting now';
  return m.mode === 'interrupt' ? 'Interrupting, runs next' : 'Steering, delivered at its next step';
}

/**
 * Messages (and crew reports) the agent has not read yet; shown under the live output.
 * `starting`: no turn is under way yet, so the first sent message starts one instead of steering it.
 * Queued and held messages Ben sent can be edited, moved and removed until the runner sends them
 * (apps/web/src/pending-edits.ts). Messages a restart left waiting on Ben come last, with Resume and Send again
 * (`ParkedMessages`). An edit whose message went first stays below, with Ben's text.
 */
export function QueuedMessages({
  items,
  starting = false,
  threadId,
  onPending,
  setup = null,
}: {
  items: PendingMsg[];
  starting?: boolean;
  /** The thread's worktree is not ready: what waits sends once it is, so Retry (SetupCard) stands in for Resume. */
  setup?: Thread['setup'];
  /** Needed for the actions on Ben's own messages. */
  threadId?: string;
  /** The pending list an action answered with, before the stream brings it. */
  onPending?: (items: PendingMsg[]) => void;
}) {
  const [drafts, setDrafts] = useState<EditDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every new pending list: an open edit whose message was sent meanwhile turns stale and keeps its text.
  useEffect(() => setDrafts((d) => reconcileEdits(d, items)), [items]);
  const stale = drafts.filter((d) => d.status === 'stale');
  if (!items.length && !stale.length) return null;
  const live = items.filter((m) => !isParked(m));
  const parked = items.filter(isParked);
  const lead = starting ? live.find((m) => m.state === 'sent') : undefined;
  const path = (rest: string) => `/threads/${encodeURIComponent(threadId ?? '')}/requests${rest}`;
  const update = (uuid: string, fn: (d: EditDraft) => EditDraft | null) =>
    setDrafts((all) => all.flatMap((d) => (d.uuid === uuid ? (fn(d) ?? []) : [d])));

  const act = async (key: string, call: () => Promise<{ pending?: PendingMsg[] }>) => {
    setBusy(key);
    setError(null);
    try {
      const res = await call();
      if (res.pending) onPending?.(res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const save = async (d: EditDraft) => {
    if (!d.prompt.trim()) return;
    update(d.uuid, (x) => ({ ...x, status: 'saving', error: undefined }));
    try {
      const res = await api.send<{ pending?: PendingMsg[] }>(path(`/${encodeURIComponent(d.uuid)}`), editBody(d), d.added, 'PATCH');
      update(d.uuid, () => null);
      if (res.pending) onPending?.(res.pending);
    } catch (e) {
      update(d.uuid, (x) => editFailed(x, e instanceof ApiError ? e.status : 0, errorText(e)));
    }
  };
  const actions = {
    busy,
    drafts,
    items,
    edit: (m: PendingMsg) => setDrafts((all) => [...all.filter((d) => d.uuid !== m.uuid), openEdit(m)]),
    change: (uuid: string, fn: (d: EditDraft) => EditDraft) => update(uuid, fn),
    close: (uuid: string) => update(uuid, () => null),
    save,
    remove: (m: PendingMsg) => void act(`remove:${m.uuid}`, () => api.post(path('/cancel'), { ids: [m.uuid] })),
    move: (m: PendingMsg, step: -1 | 1) => {
      const ids = movedOrder(items, m.uuid, step);
      if (ids) void act(`move:${m.uuid}`, () => api.post(path('/reorder'), { ids }));
    },
  };
  const ownRow = (m: PendingMsg, label: string, icon: 'send' | 'clock' | 'alert', extra?: ReactNode) => {
    const d = drafts.find((x) => x.uuid === m.uuid && x.status !== 'stale');
    if (d) return <EditBox key={m.uuid} draft={d} label={label} actions={actions} />;
    return (
      <PendingBubble key={m.uuid} m={m} label={label} icon={icon}>
        <PendingActions m={m} actions={actions}>
          {extra}
        </PendingActions>
      </PendingBubble>
    );
  };

  return (
    <div className="mt-5 flex flex-col gap-3">
      {live.map((m, i) =>
        m.kind === 'crew_report' ? (
          <div key={m.uuid ?? i} className="flex items-center gap-1.5 text-[12px] text-fg-3">
            <Icon name={m.state === 'sent' ? 'send' : 'clock'} size={12} />
            <span className="truncate">
              {pendingLabel(m, m === lead)}
              {m.role ? ` from ${m.role}` : ''}
              {m.task_id ? ` · ${m.task_id}` : ''}
            </span>
          </div>
        ) : threadId && isEditable(m) ? (
          ownRow(m, setup ? SETUP_LABEL : pendingLabel(m, false), 'clock')
        ) : (
          <PendingBubble key={m.uuid ?? i} m={m} label={setup ? SETUP_LABEL : pendingLabel(m, m === lead)} icon={m.state === 'sent' ? 'send' : 'clock'} />
        ),
      )}
      {parked.length > 0 && threadId && <ParkedMessages threadId={threadId} items={parked} onPending={onPending} row={ownRow} busy={busy} setup={setup} />}
      {error && <div className="text-right text-[12px] text-needs">{error}</div>}
      {threadId && stale.map((d) => <StaleEdit key={d.uuid} threadId={threadId} draft={d} onClose={() => actions.close(d.uuid)} />)}
    </div>
  );
}

interface PendingActionsApi {
  busy: string | null;
  drafts: EditDraft[];
  items: PendingMsg[];
  edit: (m: PendingMsg) => void;
  change: (uuid: string, fn: (d: EditDraft) => EditDraft) => void;
  close: (uuid: string) => void;
  save: (d: EditDraft) => Promise<void>;
  remove: (m: PendingMsg) => void;
  move: (m: PendingMsg, step: -1 | 1) => void;
}

/** Up, down, Edit and Remove under one of Ben's unsent messages, plus whatever else the row offers. */
function PendingActions({ m, actions: a, children }: { m: PendingMsg; actions: PendingActionsApi; children?: ReactNode }) {
  const off = !!a.busy;
  return (
    <div className="mt-1 flex flex-wrap items-center justify-end gap-0.5">
      {children}
      <IconButton icon="arrowUp" label="Move up" size={14} className="h-7 w-7" disabled={off || !canMove(a.items, m.uuid, -1)} onClick={() => a.move(m, -1)} />
      <IconButton icon="arrowDown" label="Move down" size={14} className="h-7 w-7" disabled={off || !canMove(a.items, m.uuid, 1)} onClick={() => a.move(m, 1)} />
      <Button size="sm" variant="ghost" icon="pencil" disabled={off} onClick={() => a.edit(m)}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" icon="trash" busy={a.busy === `remove:${m.uuid}`} disabled={off} onClick={() => a.remove(m)}>
        Remove
      </Button>
    </div>
  );
}

/** One unsent message being edited, in place of its bubble. The composer's draft is untouched. */
function EditBox({ draft: d, label, actions: a }: { draft: EditDraft; label: string; actions: PendingActionsApi }) {
  const m = a.items.find((x) => x.uuid === d.uuid);
  const kept = (m?.attachments ?? []).filter((f) => d.keep.includes(f.name));
  const saving = d.status === 'saving';
  const pick = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-end">
      <div className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-fg-3">
        <Icon name="pencil" size={12} /> Editing · {label}
      </div>
      <div className="w-full max-w-[92%] rounded-[22px] rounded-tr-lg border border-line-strong bg-surface px-4 py-3 sm:max-w-[80%]">
        <textarea
          aria-label="Edit queued message"
          autoFocus
          value={d.prompt}
          rows={Math.min(10, Math.max(2, d.prompt.split('\n').length))}
          disabled={saving}
          onChange={(e) => a.change(d.uuid, (x) => ({ ...x, prompt: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void a.save(d);
            } else if (e.key === 'Escape') a.close(d.uuid);
          }}
          className="w-full resize-none bg-transparent text-[14px] leading-[1.55] text-fg outline-none"
        />
        {kept.length + d.added.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {kept.map((f) => (
              <FileChip key={`k:${f.name}`} name={f.name} size={f.size} disabled={saving} onRemove={() => a.change(d.uuid, (x) => ({ ...x, keep: x.keep.filter((n) => n !== f.name) }))} />
            ))}
            {d.added.map((f, i) => (
              <FileChip key={`a:${f.name}:${i}`} name={f.name} size={f.size} disabled={saving} onRemove={() => a.change(d.uuid, (x) => ({ ...x, added: x.added.filter((y) => y !== f) }))} />
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <input
            ref={pick}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              a.change(d.uuid, (x) => ({ ...x, added: [...x.added, ...files] }));
            }}
          />
          <IconButton icon="paperclip" label="Attach files" size={15} disabled={saving} onClick={() => pick.current?.click()} />
          <span className="flex-1" />
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => a.close(d.uuid)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" icon="check" busy={saving} disabled={!d.prompt.trim()} onClick={() => void a.save(d)}>
            Save
          </Button>
        </div>
      </div>
      {d.error && <div className="mt-1 text-right text-[12px] text-needs">{d.error}</div>}
    </div>
  );
}

function FileChip({ name, size, disabled, onRemove }: { name: string; size: number; disabled?: boolean; onRemove: () => void }) {
  return (
    <span className="flex h-8 max-w-[15rem] items-center gap-1.5 rounded-full bg-surface-2 pr-0.5 pl-2.5 text-[12px]">
      <Icon name="file" size={13} className="text-fg-3" />
      <span className="min-w-0 truncate font-medium text-fg-2">{name}</span>
      <span className="font-num text-[10.5px] text-fg-4">{bytes(size)}</span>
      <IconButton icon="x" label={`Remove ${name}`} size={12} className="h-6 w-6" disabled={disabled} onClick={onRemove} />
    </span>
  );
}

/** An edit the server refused because its message was sent first. Ben's text stays until he copies, sends or drops it. */
function StaleEdit({ threadId, draft: d, onClose }: { threadId: string; draft: EditDraft; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // One id for this text, so a retried send is answered as the same message.
  const [requestId] = useState(() => requestIdFor(null, d.uuid).id);
  const sendNew = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.send(`/threads/${encodeURIComponent(threadId)}/messages`, { prompt: d.prompt.trim(), mode: 'queue', request_id: requestId }, d.added);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end" role="status">
      <div className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-needs">
        <Icon name="alert" size={12} /> {d.error ?? STALE_NOTE}
      </div>
      <div className="max-w-[92%] rounded-[22px] rounded-tr-lg border border-line-strong bg-surface-2 px-4 py-2.5 text-[14px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%]">
        {d.prompt}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={copied ? 'check' : 'copy'}
          onClick={() => {
            void copyText(d.prompt);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="secondary" icon="send" busy={busy} disabled={!d.prompt.trim()} onClick={() => void sendNew()}>
          Send as new
        </Button>
        <Button size="sm" variant="ghost" icon="x" disabled={busy} onClick={onClose}>
          Dismiss
        </Button>
      </div>
      {error && <div className="mt-1 text-right text-[12px] text-needs">{error}</div>}
    </div>
  );
}

function PendingBubble({ m, label, icon, children }: { m: PendingMsg; label: string; icon: 'send' | 'clock' | 'alert'; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-end">
      <div className="flex w-full flex-col items-end opacity-70">
        <div className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-fg-3">
          <Icon name={icon} size={12} /> {label}
          {m.attachments?.length ? <span className="text-fg-4">· {plural(m.attachments.length, 'file')}</span> : null}
        </div>
        <div className="max-w-[92%] rounded-[22px] rounded-tr-lg border border-dashed border-line-strong px-4 py-2.5 text-[14px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%]">
          {m.text}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * Messages Omni accepted before it restarted, and crew reports kept for a thread Ben stopped. A recovered one never
 * reached the agent: Resume sends every one in the saved order. An uncertain one may have, so it is only sent again
 * when Ben says so. Editing, moving or removing one never resumes anything. A crew report or a team's go is Omni's,
 * not Ben's: it has Discard (it stays in the transcript, marked not sent) instead of Edit, moves and Remove.
 */
function ParkedMessages({
  threadId,
  items,
  onPending,
  row,
  busy: rowBusy,
  setup,
}: {
  threadId: string;
  items: PendingMsg[];
  onPending?: (items: PendingMsg[]) => void;
  row: (m: PendingMsg, label: string, icon: 'send' | 'clock' | 'alert', extra?: ReactNode) => ReactNode;
  busy: string | null;
  setup?: Thread['setup'];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { recovered } = parkedOf(items);
  const off = !!busy || !!rowBusy;
  const resume = async (key: string, ids?: string[]) => {
    setBusy(key);
    setError(null);
    try {
      const res = await api.post<{ pending?: PendingMsg[] }>(`/threads/${encodeURIComponent(threadId)}/requests/resume`, ids ? { ids } : {});
      if (res.pending) onPending?.(res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const discard = async (uuid: string) => {
    setBusy(`discard:${uuid}`);
    setError(null);
    try {
      const res = await api.post<{ pending?: PendingMsg[] }>(`/threads/${encodeURIComponent(threadId)}/requests/discard`, { ids: [uuid] });
      if (res.pending) onPending?.(res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-fg-3">{setup ? SETUP_LABEL : parkedHeading(items)}</span>
        {recovered.length > 0 && !setup && (
          <Button size="sm" variant="primary" icon="play" busy={busy === 'resume'} disabled={off} onClick={() => void resume('resume')}>
            Resume{recovered.length > 1 ? ` ${recovered.length}` : ''}
          </Button>
        )}
      </div>
      {items.map((m) => {
        const again = m.delivery === 'uncertain' && (
          <Button size="sm" variant="secondary" icon="send" busy={busy === `again:${m.uuid}`} disabled={off} onClick={() => void resume(`again:${m.uuid}`, [m.uuid])}>
            Send again
          </Button>
        );
        const icon = m.delivery === 'uncertain' ? 'alert' : 'clock';
        const label = setup ? 'Waits for the worktree' : parkedLabel(m);
        if (!isOmnis(m)) return row(m, label ?? '', icon, again);
        return (
          <PendingBubble key={m.uuid} m={m} label={label ?? 'Held for Resume'} icon={icon}>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-0.5">
              {again}
              <Button size="sm" variant="ghost" icon="trash" busy={busy === `discard:${m.uuid}`} disabled={off} onClick={() => void discard(m.uuid)}>
                Discard
              </Button>
            </div>
          </PendingBubble>
        );
      })}
      {error && <div className="text-right text-[12px] text-needs">{error}</div>}
    </div>
  );
}

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

function UserBubble({ p, at, threadId }: { p: UserP; at: string; threadId: string }) {
  const [more, setMore] = useState(false);
  // Where the pill whose description is open starts.
  const [about, setAbout] = useState<number | null>(null);
  const text = p.text ?? '';
  const long = text.length > 1400;
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
          <span className="inline-flex items-center gap-1 font-medium" title="The run ended before the agent read this message">
            <Icon name="x" size={11} /> Not sent
          </span>
        )}
        <span className="font-num text-[11px] text-fg-4">{clock(toDate(at))}</span>
      </div>
      {p.attachments?.length ? <Attachments threadId={threadId} items={p.attachments} /> : null}
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
      </div>
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
          <span className="text-[11.5px] font-medium text-fg-3" title="The run ended before the agent read this report">
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
function PlanCard({ todos }: { todos: Todo[] }) {
  const done = todos.filter((t) => t.status === 'completed').length;
  const active = todos.find((t) => t.status === 'in_progress');
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
        <CheckItem key={k} state={t.status ?? 'pending'}>
          {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
        </CheckItem>
      ))}
      {!active && done === todos.length && todos.length > 0 && <div className="mt-1.5 text-[12px] text-fg-4">All done</div>}
    </section>
  );
}

// ---------- transcript ----------

export const Transcript = memo(function Transcript({
  threadId,
  events,
  running,
  cwd,
  known = NO_THREADS,
  team,
  artifacts = NO_ARTIFACTS,
  reports = NO_REPORTS,
}: {
  threadId: string;
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
}) {
  const byId = useMemo(() => new Map(known.map((t) => [t.id, t])), [known]);
  const { items, plan } = useMemo(() => buildItems(events), [events]);
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

  return (
    <TaskCtx.Provider value={tasks}>
      <div className="space-y-4">
        {items.map((it, idx) => {
          switch (it.type) {
            case 'user': {
              const bubble = <UserBubble key={it.key} p={it.p} at={it.at} threadId={threadId} />;
              return idx === 0 && team?.length ? [bubble, <DelegationCard key="team" branches={team} team reports={reports} />] : bubble;
            }
            case 'text':
              return (
                <div key={it.key} className="group/msg flex flex-col">
                  <Markdown text={it.p.text ?? ''} />
                  <CopyMsg text={it.p.text ?? ''} />
                </div>
              );
            case 'tools': {
              const { agents, rest, agentsFirst } = splitGroup(it.calls);
              const cards = [
                ...delegations(it.calls).map((d) => (
                  <DelegationCard key={`d${d.key}`} lead={d.lead && withLive(d.lead, byId)} branches={d.branches.map((b) => withLive(b, byId))} reports={reports} />
                )),
                ...(pages.get(it.key) ?? []).map((p) => (
                  <PublishedCard key={`p${p.url}`} p={p} threadId={threadId} artifact={artifacts.findLast((a) => a.url === p.url)} />
                )),
              ];
              const isLast = idx === lastIdx;
              const group = rest.length ? (
                <ToolGroup key={it.key} calls={rest} total={rest.length + rest.reduce((n, c) => n + countCalls(c), 0)} cwd={cwd} running={running} isLast={isLast} />
              ) : null;
              const subagents = agents.length ? (
                <DelegationCard key={`a${it.key}`} agents={agents.map((c) => <AgentRow key={c.id} c={c} cwd={cwd} running={running} />)} />
              ) : null;
              const out = [...(agentsFirst ? [subagents, group] : [group, subagents]), ...cards].filter(Boolean);
              // One keyed plan card that follows the latest TodoWrite, so ticks animate instead of remounting.
              return plan?.after === it.key ? [...out, <PlanCard key="plan" todos={plan.todos} />] : out;
            }
            case 'result':
              return <ResultLine key={it.key} p={it.p} />;
            case 'error':
              return <ErrorCallout key={it.key} text={it.p.text ?? ''} />;
            case 'report':
              return <ReportCard key={it.key} p={it.p} />;
            case 'mod':
              return <ModLog key={it.key} lines={it.lines} />;
            default:
              return null;
          }
        })}
        {(showWorking || latestStatus) && (
          <div className="flex items-center gap-2 text-[12.5px] text-fg-3">
            {running && <Loader size={13} />}
            <span className="truncate">{latestStatus ?? 'Working'}</span>
          </div>
        )}
      </div>
    </TaskCtx.Provider>
  );
});
