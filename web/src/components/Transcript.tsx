import { memo, useMemo, useState, type ReactNode } from 'react';
import { parsePayload, type EventRow } from '../api.ts';
import { clock, duration, plural, shortPath, toDate } from '../format.ts';
import { href } from '../router.ts';
import { Markdown } from './Markdown.tsx';
import { Icon, Spinner, StatusPill } from './ui.tsx';

// ---------- payloads ----------

interface UserP {
  text: string;
  source?: string;
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

function buildItems(events: EventRow[]): Item[] {
  const results = new Map<string, ToolResultP>();
  for (const e of events) {
    if (e.kind === 'tool_result') {
      const p = parsePayload<ToolResultP>(e);
      if (p.tool_use_id) results.set(p.tool_use_id, p);
    }
  }
  const items: Item[] = [];
  let group: { item: Extract<Item, { type: 'tools' }>; byId: Map<string, ToolCall> } | null = null;

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
        // Zero-turn success: the CLI flushing a background task on resume, not a real turn.
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
  return items;
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
      className={`scroll-thin max-h-80 overflow-auto rounded-md border border-line px-2.5 py-2 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap break-words ${bg} ${tone === 'bad' ? 'text-bad' : 'text-fg-2'} ${className}`}
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
      <ul className="space-y-0.5 text-[12.5px]">
        {(i.todos as { content?: string; status?: string }[]).map((t, k) => (
          <li key={k} className={`flex items-start gap-2 ${t.status === 'completed' ? 'text-fg-3 line-through' : t.status === 'in_progress' ? 'text-fg' : 'text-fg-2'}`}>
            <span className="mt-[3px] inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border border-line-strong">
              {t.status === 'completed' && <Icon name="check" size={10} strokeWidth={3} />}
              {t.status === 'in_progress' && <span className="h-1.5 w-1.5 rounded-full bg-[var(--info-dot)]" />}
            </span>
            {t.content}
          </li>
        ))}
      </ul>
    );
  }
  const json = JSON.stringify(i, null, 2);
  if (!json || json === '{}') return null;
  return <Pre>{json.length > 6000 ? json.slice(0, 6000) + '\n...' : json}</Pre>;
}

function ToolRow({ c, cwd, running, depth = 0 }: { c: ToolCall; cwd?: string | null; running: boolean; depth?: number }) {
  const [open, setOpen] = useState(false);
  const pending = !c.result;
  const err = c.result?.is_error;
  const summary = toolSummary(c, cwd);
  const mono = ['Bash', 'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep'].includes(c.name);
  const indent = depth > 0 || c.orphan;
  return (
    <div className={indent ? 'ml-3 border-l border-line pl-2.5' : ''}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-surface-2"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="text-fg-4" />
        <Icon name={toolIcon(c.name)} size={13} className={err ? 'text-bad' : 'text-fg-3'} />
        <span className={`shrink-0 font-medium ${err ? 'text-bad' : 'text-fg-2'}`}>{toolLabel(c.name)}</span>
        <span className={`min-w-0 flex-1 truncate text-fg-3 ${mono ? 'font-mono text-[11.5px]' : ''}`}>{summary}</span>
        {c.children.length > 0 && <span className="shrink-0 text-[11px] text-fg-4">{c.children.length} sub-calls</span>}
        {pending && running ? <Spinner size={11} className="text-fg-3" /> : err ? <span className="shrink-0 text-[11px] font-medium text-bad">error</span> : null}
      </button>
      {open && (
        <div className="mt-1 mb-2 ml-6 space-y-1.5">
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
  const errors = all.filter((c) => c.result?.is_error).length;
  const live = running && isLast && all.some((c) => !c.result);
  const latest = all[all.length - 1];
  const names = countNames(calls);
  return (
    <div className="rounded-lg border border-line bg-surface/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-2"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="text-fg-4" />
        <Icon name="tool" size={13} className="text-fg-3" />
        <span className="shrink-0 font-medium text-fg-2">{total} tool calls</span>
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
        {errors > 0 && <span className="shrink-0 text-[11px] font-medium text-bad">{errors} failed</span>}
        {live && <Spinner size={11} className="text-fg-3" />}
      </button>
      {open && (
        <div className="border-t border-line px-1.5 py-1">
          {calls.map((c) => (
            <ToolRow key={c.id} c={c} cwd={cwd} running={running} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- other items ----------

const SOURCE_LABEL: Record<string, string> = {
  conductor: 'from Conductor',
  automation: 'Automation',
  capture: 'Captured',
  import: 'Imported',
};

/** Follow-ups (and crew reports) waiting for the current turn; shown under the live output. */
export function QueuedMessages({ items }: { items: { kind: string; text?: string; source?: string; task_id?: string | null; role?: string | null }[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-5 flex flex-col gap-3">
      {items.map((m, i) =>
        m.kind === 'crew_report' ? (
          <div key={i} className="flex items-center gap-1.5 text-[12px] text-fg-3">
            <Icon name="clock" size={12} /> Crew report{m.task_id ? ` ${m.task_id}` : ''}{m.role ? ` from ${m.role}` : ''} queued
          </div>
        ) : (
          <div key={i} className="flex flex-col items-end opacity-70">
            <div className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-fg-3">
              <Icon name="clock" size={12} /> Queued
            </div>
            <div className="max-w-[92%] rounded-2xl rounded-tr-md border border-dashed border-line-strong px-3.5 py-2 text-[14px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%]">
              {m.text}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function UserBubble({ p, at }: { p: UserP; at: string }) {
  const [more, setMore] = useState(false);
  const text = p.text ?? '';
  const long = text.length > 1400;
  const label = p.source ? SOURCE_LABEL[p.source] : undefined;
  return (
    <div className="flex flex-col items-end">
      <div className="mb-1 flex items-center gap-2 text-[11.5px] text-fg-3">
        {label && <span className={`font-medium ${p.source === 'conductor' ? 'text-info' : ''}`}>{label}</span>}
        <span className="text-fg-4">{clock(toDate(at))}</span>
      </div>
      <div
        className={`max-w-[92%] rounded-2xl rounded-tr-md px-3.5 py-2 text-[14px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%] ${
          p.source === 'conductor' ? 'border border-info/20 bg-info-bg' : 'bg-bubble'
        }`}
      >
        {long && !more ? text.slice(0, 1200) + '...' : text}
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
    <div className="flex items-center gap-3 py-1 text-[11.5px] text-fg-4">
      <div className="h-px flex-1 bg-line" />
      <span className={bad ? 'text-bad' : ''}>
        {bits.join(' · ')}
        {bad && p.subtype && p.subtype !== 'success' ? ` · ${p.subtype.replace(/_/g, ' ')}` : ''}
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

function ErrorCallout({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-bad/25 bg-bad-bg px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-bad">
        <Icon name="alert" size={14} /> Error
      </div>
      <pre className="scroll-thin max-h-72 overflow-auto font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap break-words text-bad">{text}</pre>
    </div>
  );
}

function ReportCard({ p }: { p: ReportP }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-surface">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface-2 px-3.5 py-2 text-[12.5px]">
        <Icon name="inbox" size={14} className="text-fg-3" />
        <span className="font-semibold">Report from {p.role ?? 'crew'}</span>
        {p.task_id && <span className="font-mono text-[11.5px] text-fg-3">{p.task_id}</span>}
        {p.channel && (
          <a href={href.channel(p.channel)} className="text-fg-3 hover:text-fg">
            #{p.channel}
          </a>
        )}
        <span className="ml-auto flex items-center gap-2">
          {p.status && <StatusPill status={p.status} />}
          <a href={href.thread(p.thread_id)} className="inline-flex items-center gap-1 font-medium text-info hover:underline">
            Open thread <Icon name="chevronRight" size={12} />
          </a>
        </span>
      </div>
      {p.title && <div className="px-3.5 pt-2.5 text-[13px] font-medium text-fg-2">{p.title}</div>}
      <div className="px-3.5 py-2.5">
        <Markdown text={p.text || '(no reply)'} />
      </div>
    </div>
  );
}

// ---------- transcript ----------

export const Transcript = memo(function Transcript({
  events,
  running,
  cwd,
}: {
  events: EventRow[];
  running: boolean;
  cwd?: string | null;
}) {
  const items = useMemo(() => buildItems(events), [events]);
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
            return <UserBubble key={it.key} p={it.p} at={it.at} />;
          case 'text':
            return <Markdown key={it.key} text={it.p.text ?? ''} />;
          case 'tools':
            return <ToolGroup key={it.key} calls={it.calls} total={it.total} cwd={cwd} running={running} isLast={idx === items.length - 1} />;
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
        <div className="flex items-center gap-2 text-[12px] text-fg-3">
          {running && <Spinner size={12} />}
          <span className="truncate">{latestStatus ?? 'Working'}</span>
        </div>
      )}
    </div>
  );
});
