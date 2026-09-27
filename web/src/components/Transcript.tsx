import { Fragment, memo, useMemo, useState, type ReactNode } from 'react';
import { parsePayload, uploadUrl, type Attachment, type EventRow, type PendingMsg } from '../api.ts';
import { bytes, clock, duration, plural, shortPath, toDate } from '../format.ts';
import { href } from '../router.ts';
import { Markdown } from './Markdown.tsx';
import { CheckItem, Icon, Modal, Spinner, StatusPill, Ticks } from './ui.tsx';
import { SOURCE_TAG } from '../slash-menu.ts';
import { slashPieces } from '../slash-pills.ts';
import type { SlashHit, SlashRecord } from '../../../shared/slash.ts';

// ---------- payloads ----------

interface UserP {
  text: string;
  source?: string;
  attachments?: Attachment[];
  /** Set when the message was sent while a turn was in progress. */
  mode?: 'steer' | 'queue' | 'interrupt';
  /** The run ended before the agent saw this message. */
  dropped?: boolean;
  /** The harness command the message starts with and its Mentions, as they resolved when sent. */
  slash?: SlashRecord;
}
interface TextP {
  text: string;
}
interface ToolUseP {
  id: string;
  name: string;
  input: unknown;
  parent?: string | null;
}
interface ToolResultP {
  tool_use_id: string;
  text: string;
  is_error: boolean;
  truncated: boolean;
}
interface ResultP {
  ok: boolean;
  subtype: string;
  duration_ms?: number;
  turns?: number;
  cost_usd?: number;
  stopped?: boolean;
}
interface ReportP {
  text: string;
  task_id?: string | null;
  thread_id: string;
  title?: string;
  role?: string | null;
  channel?: string;
  status?: string;
  dropped?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  parent: string | null;
  result?: ToolResultP;
  at: string;
  children: ToolCall[];
  orphan: boolean;
}

type Item =
  | { type: 'user'; key: number; at: string; p: UserP }
  | { type: 'text'; key: number; at: string; p: TextP }
  | { type: 'tools'; key: number; calls: ToolCall[]; total: number }
  | { type: 'result'; key: number; p: ResultP }
  | { type: 'error'; key: number; p: TextP }
  | { type: 'report'; key: number; at: string; p: ReportP };

interface Todo {
  content?: string;
  activeForm?: string;
  status?: string;
}

function buildItems(events: EventRow[]): { items: Item[]; plan: { todos: Todo[]; after: number } | null } {
  const results = new Map<string, ToolResultP>();
  for (const e of events) {
    if (e.kind === 'tool_result') {
      const p = parsePayload<ToolResultP>(e);
      if (p.tool_use_id) results.set(p.tool_use_id, p);
    }
  }
  const items: Item[] = [];
  let group: { item: Extract<Item, { type: 'tools' }>; byId: Map<string, ToolCall> } | null = null;
  let plan: { todos: Todo[]; after: number } | null = null;

  for (const e of events) {
    switch (e.kind) {
      case 'tool_use': {
        const p = parsePayload<ToolUseP>(e);
        const call: ToolCall = {
          id: p.id,
          name: p.name ?? 'tool',
          input: (p.input && typeof p.input === 'object' ? p.input : { value: p.input }) as Record<string, unknown>,
          parent: p.parent ?? null,
          result: results.get(p.id),
          at: e.created_at,
          children: [],
          orphan: false,
        };
        if (!group) {
          group = { item: { type: 'tools', key: e.id, calls: [], total: 0 }, byId: new Map() };
          items.push(group.item);
        }
        group.byId.set(call.id, call);
        group.item.total++;
        if (call.name === 'TodoWrite' && Array.isArray(call.input.todos)) plan = { todos: call.input.todos as Todo[], after: group.item.key };
        const parent = call.parent ? group.byId.get(call.parent) : undefined;
        if (parent) parent.children.push(call);
        else {
          call.orphan = !!call.parent;
          group.item.calls.push(call);
        }
        break;
      }
      case 'tool_result':
      case 'status':
      case 'init':
        break;
      case 'user':
        group = null;
        items.push({ type: 'user', key: e.id, at: e.created_at, p: parsePayload<UserP>(e) });
        break;
      case 'assistant_text':
        group = null;
        items.push({ type: 'text', key: e.id, at: e.created_at, p: parsePayload<TextP>(e) });
        break;
      case 'result': {
        const p = parsePayload<ResultP>(e);
        // Zero-turn success is not a real turn: a local slash command (its output is stored as text
        // just before) or, in older threads, the CLI flushing a background task on resume.
        if (p.ok && !p.turns) break;
        group = null;
        items.push({ type: 'result', key: e.id, p });
        break;
      }
      case 'error':
        group = null;
        items.push({ type: 'error', key: e.id, p: parsePayload<TextP>(e) });
        break;
      case 'crew_report':
        group = null;
        items.push({ type: 'report', key: e.id, at: e.created_at, p: parsePayload<ReportP>(e) });
        break;
      default:
        break;
    }
  }
  return { items, plan };
}

// ---------- tool summaries ----------

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

function firstLine(s: string, max = 160) {
  const line = s.trim().split('\n')[0] ?? '';
  return line.length > max ? line.slice(0, max - 1) + '...' : line;
}

export function toolLabel(name: string) {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  if (m) {
    const server = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(m[1]) ? 'mcp' : m[1].replace(/^plugin_[^_]+_/, '');
    return `${server} · ${m[2]}`;
  }
  return name;
}

export function toolSummary(c: Pick<ToolCall, 'name' | 'input'>, cwd?: string | null): string {
  const i = c.input;
  const n = c.name;
  if (n === 'Bash' || n === 'BashOutput') return firstLine(str(i.command) || str(i.description) || str(i.bash_id));
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'NotebookRead'].includes(n)) return shortPath(str(i.file_path) || str(i.notebook_path), cwd);
  if (n === 'Glob') return str(i.pattern);
  if (n === 'Grep') return `${str(i.pattern)}${i.path ? `  in ${shortPath(str(i.path), cwd)}` : ''}`;
  if (n === 'WebFetch') return str(i.url);
  if (n === 'WebSearch') return str(i.query);
  if (n === 'Task' || n === 'Agent') return `${str(i.description)}${i.subagent_type ? ` (${str(i.subagent_type)})` : ''}`;
  if (n === 'TodoWrite') {
    const todos = Array.isArray(i.todos) ? (i.todos as { status?: string }[]) : [];
    const done = todos.filter((t) => t.status === 'completed').length;
    return `${done}/${todos.length} done`;
  }
  if (n === 'Skill') return str(i.skill) || str(i.command);
  if (n === 'KillShell' || n === 'KillBash') return str(i.shell_id);
  for (const k of ['url', 'query', 'q', 'path', 'file_path', 'selector', 'name', 'title', 'id', 'command', 'prompt', 'text']) {
    if (str(i[k])) return firstLine(str(i[k]));
  }
  for (const v of Object.values(i)) if (str(v)) return firstLine(str(v));
  return '';
}

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
      className={`scroll-thin max-h-80 overflow-auto rounded-xl px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap break-words shadow-[inset_0_0_0_1px_var(--line)] ${bg} ${tone === 'bad' ? 'text-bad' : 'text-fg-2'} ${className}`}
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

function ToolRow({ c, cwd, running, depth = 0 }: { c: ToolCall; cwd?: string | null; running: boolean; depth?: number }) {
  const [open, setOpen] = useState(false);
  const pending = !c.result;
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
        <Icon name={toolIcon(c.name)} size={13} className={err ? 'text-bad' : 'text-fg-3'} />
        <span className={`shrink-0 font-medium ${err ? 'text-bad' : 'text-fg-2'}`}>{toolLabel(c.name)}</span>
        <span className={`min-w-0 flex-1 truncate text-fg-3 ${mono ? 'font-mono text-[11.5px]' : ''}`}>{summary}</span>
        {c.children.length > 0 && <span className="shrink-0 font-num text-[11px] text-fg-4">{c.children.length} sub-calls</span>}
        {pending && running ? (
          <Spinner size={11} className="text-fg-3" />
        ) : err ? (
          <span className="shrink-0 font-num text-[11px] text-bad">error</span>
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
      {c.children.length > 0 && (open || (pending && running)) && (
        <div className="mb-1 ml-3">
          {(open ? c.children : c.children.slice(-3)).map((ch) => (
            <ToolRow key={ch.id} c={ch} cwd={cwd} running={running} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
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
        {errors > 0 && <span className="shrink-0 font-num text-[11px] text-bad">{errors} failed</span>}
        {live && <Spinner size={11} className="text-fg-3" />}
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
  automation: 'Automation',
  capture: 'Captured',
  import: 'Imported',
};

function pendingLabel(m: PendingMsg, lead: boolean) {
  if (m.state === 'waiting') return 'Waiting for a free slot';
  if (m.state === 'held') return 'Queued, runs after this turn';
  if (lead) return 'Sent, starting now';
  return m.mode === 'interrupt' ? 'Interrupting, runs next' : 'Steering, delivered at its next step';
}

/**
 * Messages (and crew reports) the agent has not read yet; shown under the live output.
 * `starting`: no turn is under way yet, so the first sent message starts one instead of steering it.
 */
export function QueuedMessages({ items, starting = false }: { items: PendingMsg[]; starting?: boolean }) {
  if (!items.length) return null;
  const lead = starting ? items.find((m) => m.state === 'sent') : undefined;
  return (
    <div className="mt-5 flex flex-col gap-3">
      {items.map((m, i) =>
        m.kind === 'crew_report' ? (
          <div key={m.uuid ?? i} className="flex items-center gap-1.5 text-[12px] text-fg-3">
            <Icon name={m.state === 'sent' ? 'send' : 'clock'} size={12} />
            <span className="min-w-0">
              Crew report{m.task_id ? ` ${m.task_id}` : ''}
              {m.role ? ` from ${m.role}` : ''}
              {m === lead ? ', starting now' : m.state === 'sent' ? ', delivered at its next step' : m.state === 'waiting' ? ', waiting for a free slot' : ' queued'}
            </span>
          </div>
        ) : (
          <div key={m.uuid ?? i} className="flex flex-col items-end opacity-70">
            <div className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-fg-3">
              <Icon name={m.state === 'sent' ? 'send' : 'clock'} size={12} /> {pendingLabel(m, m === lead)}
              {m.attachments?.length ? <span className="text-fg-4">· {plural(m.attachments.length, 'file')}</span> : null}
            </div>
            <div className="max-w-[92%] rounded-[22px] rounded-tr-lg border border-dashed border-line-strong px-4 py-2.5 text-[14px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%]">
              {m.text}
            </div>
          </div>
        ),
      )}
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
    <div className={`flex flex-col items-end ${p.dropped ? 'opacity-60' : ''}`}>
      <div className="mb-1 flex flex-wrap items-center justify-end gap-x-2 text-[11.5px] text-fg-3">
        {label && <span className={`font-medium ${p.source === 'conductor' ? 'text-info' : ''}`}>{label}</span>}
        {how && (
          <span className={`inline-flex items-center gap-1 font-medium ${p.mode === 'interrupt' ? 'text-warn' : ''}`}>
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
          p.dropped ? 'border border-dashed border-line-strong' : p.source === 'conductor' ? 'bg-info-bg text-fg' : 'bg-bubble'
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
    </div>
  );
}

function ResultLine({ p }: { p: ResultP }) {
  const word = p.ok ? 'done' : p.stopped ? 'stopped' : 'ended';
  const bits = [p.duration_ms != null ? `${word} in ${duration(p.duration_ms)}` : word];
  if (p.turns) bits.push(plural(p.turns, 'turn'));
  const bad = !p.ok && !p.stopped;
  return (
    <div className="flex items-center gap-3 py-1 font-num text-[10.5px] tracking-[0.06em] text-fg-4 uppercase">
      <div className="h-px flex-1 bg-line" />
      <span className={`flex items-center gap-2 ${bad ? 'text-bad' : ''}`}>
        <span className={`inline-block h-1 w-1 rounded-full ${bad ? 'bg-bad' : p.ok ? 'bg-[var(--ok-dot)]' : 'bg-[var(--warn-dot)]'}`} />
        {bits.join(' · ')}
        {bad && p.subtype && p.subtype !== 'success' ? ` · ${p.subtype.replace(/_/g, ' ')}` : ''}
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

function ErrorCallout({ text }: { text: string }) {
  return (
    <div className="rounded-[20px] bg-bad-bg px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-bad">
        <Icon name="alert" size={14} /> Error
      </div>
      <pre className="scroll-thin max-h-72 overflow-auto font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap break-words text-bad">{text}</pre>
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
        <span className="label-mono">Plan</span>
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
}: {
  threadId: string;
  events: EventRow[];
  running: boolean;
  cwd?: string | null;
}) {
  const { items, plan } = useMemo(() => buildItems(events), [events]);
  const latestStatus = useMemo(() => {
    if (!running) return null;
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k];
      if (e.kind === 'status') return parsePayload<TextP>(e).text;
      if (e.kind === 'user') return null;
    }
    return null;
  }, [events, running]);

  const last = items[items.length - 1];
  const showWorking = running && (!last || last.type === 'user' || last.type === 'report' || last.type === 'text');

  return (
    <div className="space-y-4">
      {items.map((it, idx) => {
        switch (it.type) {
          case 'user':
            return <UserBubble key={it.key} p={it.p} at={it.at} threadId={threadId} />;
          case 'text':
            return <Markdown key={it.key} text={it.p.text ?? ''} />;
          case 'tools': {
            const group = <ToolGroup key={it.key} calls={it.calls} total={it.total} cwd={cwd} running={running} isLast={idx === items.length - 1} />;
            // One keyed plan card that follows the latest TodoWrite, so ticks animate instead of remounting.
            return plan?.after === it.key ? [group, <PlanCard key="plan" todos={plan.todos} />] : group;
          }
          case 'result':
            return <ResultLine key={it.key} p={it.p} />;
          case 'error':
            return <ErrorCallout key={it.key} text={it.p.text ?? ''} />;
          case 'report':
            return <ReportCard key={it.key} p={it.p} />;
          default:
            return null;
        }
      })}
      {(showWorking || latestStatus) && (
        <div className="flex items-center gap-2 text-[12.5px] text-fg-3">
          {running && <Spinner size={12} />}
          <span className={`truncate ${running ? 'shimmer' : ''}`}>{latestStatus ?? 'Working'}</span>
        </div>
      )}
    </div>
  );
});
