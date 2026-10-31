import { createContext, useContext, useState, type ReactNode } from 'react';
import { duration, plural, toDate } from '../../format.ts';
import { useNow } from '../../store.tsx';
import { BranchFace, RailItem, ROW_CARD } from '../Delegation.tsx';
import { ClippedNote } from './HistoryEdgeRow.tsx';
import { ToolOutput } from './ToolOutput.tsx';
import { CheckItem, Icon, Loader, StatusDot } from '../ui.tsx';
import { str, toolLabel, toolSummary, type TaskView, type Todo, type ToolCall } from '../../transcript/fold.ts';
import { agentStatus, TASK_END } from '../../transcript/delegation.ts';
import { exitCodeOf, outputMeta } from '@omni/shared/tool-output.ts';

export const TaskCtx = createContext<Map<string, TaskView>>(new Map());

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

/** A call's output in the box a tool row shows it in. */
const outputBox = (err?: boolean) => (text: string) => <Pre tone={err ? 'bad' : undefined}>{text || '(no output)'}</Pre>;

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

/** Every call a sub-agent made, however deep. */
export const countCalls = (c: ToolCall): number => c.children.reduce((n, ch) => n + 1 + countCalls(ch), 0);

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
  const exit = c.result && (c.result.output?.exit_code ?? exitCodeOf(c.result.text));
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
            <StatusDot status="needs" size={7} /> error{exit !== undefined && ` · exit ${exit}`}
          </span>
        ) : stopped ? (
          <span className="shrink-0 font-num text-[11px] text-fg-4">stopped</span>
        ) : null}
      </button>
      {open && (
        <div className="fade-in mt-1 mb-2.5 ml-7 space-y-1.5">
          <ToolInput c={c} />
          <ClippedNote event={c.event} clipped={c.clipped} />
          <ToolOutput call={c} running={running} box={outputBox(err)} />
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
export function AgentRow({ c, cwd, running }: { c: ToolCall; cwd?: string | null; running: boolean }) {
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
          <ClippedNote event={c.event} clipped={c.clipped} />
          {c.result && outputMeta(c.result) ? <ToolOutput call={c} running={running} box={outputBox(err)} /> : c.result ? <Pre tone={err ? 'bad' : undefined}>{c.result.text || '(no output)'}</Pre> : null}
          {c.result && <ClippedNote event={c.result.event} clipped={c.result.clipped} />}
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

export function flatten(calls: ToolCall[]): ToolCall[] {
  return calls.flatMap((c) => [c, ...flatten(c.children)]);
}

export function ToolGroup({ calls, total, cwd, running, isLast }: { calls: ToolCall[]; total: number; cwd?: string | null; running: boolean; isLast: boolean }) {
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
