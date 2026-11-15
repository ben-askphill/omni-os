// The thread tree under a job's row: the threads it delegated, its team's members and what runs under them, one line
// each on the tree line the sidebar draws for sub-agents. The same rows sit under a sidebar row, an Inbox card and a
// phone Activity row. Which rows show, and in what state, is @omni/shared/thread-tree.ts.
import { useState } from 'react';
import { toDate, relTime } from '@omni/shared/format.ts';
import { treeRows, type Tally } from '@omni/shared/thread-tree.ts';
import type { BackgroundTask } from '../api.ts';
import { duration, plural } from '../format.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import type { JobTree, StubNode } from '../thread-tree.ts';
import { HarnessLogo, Loader, harnessLabel } from './brand.tsx';
import { DoneMark, Icon, StatusDot, statusLabel } from './ui.tsx';

/** sidebar and inbox: 28px rows on desktop. phone: 36px rows with the time on the right. */
export type TreeVariant = 'sidebar' | 'inbox' | 'phone';

const ROW: Record<TreeVariant, string> = {
  sidebar: 'h-8 text-[13px] md:h-7 md:text-[12.5px]',
  inbox: 'h-8 text-[13px] md:h-7 md:text-[12.5px]',
  phone: 'h-9 text-[14px]',
};

/** One state's glyph and count, for the tally on a job's row. */
const TALLY: { key: keyof Tally; glyph: 'needs' | 'failed' | 'running' | 'done'; label: string }[] = [
  { key: 'needs', glyph: 'needs', label: 'need you' },
  { key: 'failed', glyph: 'failed', label: 'failed' },
  { key: 'running', glyph: 'running', label: 'running' },
  { key: 'done', glyph: 'done', label: 'done' },
];

export const tallyLabel = (t: Tally) =>
  TALLY.filter((x) => t[x.key])
    .map((x) => `${t[x.key]} ${x.label}`)
    .join(', ');

/** How many threads under a job are in each state: needs you, failed, running, done. */
export function TreeTally({ tally, size = 6 }: { tally: Tally; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-[7px] font-num text-[11px] text-fg-3 tabular-nums">
      {TALLY.filter((x) => tally[x.key]).map((x) => (
        <span key={x.key} className="inline-flex items-center gap-[3px]">
          {x.glyph === 'running' ? <Loader size={size + 3} className="text-live-text" /> : <StatusDot status={x.glyph} size={size} />}
          {tally[x.key]}
        </span>
      ))}
    </span>
  );
}

/**
 * The job's tally with a chevron, a button that opens and closes its tree. `label` leads it on a sidebar row's second
 * line (the branch, or "4 delegated"); an Inbox card and a phone row have that line already and show only the tally.
 */
export function TreeToggle({ tree, title, label, className = '' }: { tree: JobTree; title: string; label?: string; className?: string }) {
  const what = `${tree.open ? 'Close' : 'Open'} the threads under ${title}: ${tallyLabel(tree.tally)}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        tree.toggle();
      }}
      aria-expanded={tree.open}
      aria-label={what}
      title={what}
      data-tree-toggle
      className={`hov z-[2] flex min-w-0 items-center gap-2 rounded-full text-[11px] text-fg-3 transition-colors hover:text-fg-2 ${className}`}
    >
      <ToggleFace tree={tree} label={label} />
    </button>
  );
}

/** The toggle's size without the button, to hold its place on a line it is laid over (a link can't hold a button). */
export function TreeToggleSpace({ tree, className = '' }: { tree: JobTree; className?: string }) {
  return (
    <span aria-hidden className={`invisible flex items-center gap-2 text-[11px] ${className}`}>
      <ToggleFace tree={tree} />
    </span>
  );
}

function ToggleFace({ tree, label }: { tree: JobTree; label?: string }) {
  return (
    <>
      {label && <span className={`min-w-0 truncate ${label.includes('/') ? 'font-mono text-[10.5px]' : ''}`}>{label}</span>}
      <TreeTally tally={tree.tally} />
      <Icon name={tree.open ? 'chevronDown' : 'chevronRight'} size={11} className="-mr-0.5 shrink-0 text-fg-3" />
    </>
  );
}

/**
 * The rows under a job. `agents`: the live tasks, to nest each thread's running sub-agents under its row (the Inbox
 * passes them only for a card on its Working shelf). On the phone they shrink to one "n agents running" row.
 */
export function TreeRows({
  tree,
  variant,
  agents,
  onNavigate,
  className = '',
}: {
  tree: JobTree;
  variant: TreeVariant;
  agents?: readonly BackgroundTask[];
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Threads under this one" data-thread-tree={variant} className={className}>
      <Level nodes={tree.nodes} open={tree.open} onOpen={tree.toggle} spans={tree.spans} variant={variant} agents={agents} onNavigate={onNavigate} />
    </div>
  );
}

function Level({
  nodes,
  open,
  onOpen,
  spans,
  variant,
  agents,
  onNavigate,
}: {
  nodes: StubNode[];
  open: boolean;
  onOpen?: () => void;
  spans: boolean;
  variant: TreeVariant;
  agents?: readonly BackgroundTask[];
  onNavigate?: () => void;
}) {
  const [all, setAll] = useState(false);
  const { rows, more } = treeRows(nodes, open, all);
  // Closed with nothing that needs Ben, the toggle's tally says it all: no "n more" row on its own.
  if (!rows.length && (!open || !more.length)) return null;
  const moreLabel = open ? `${more.length} more done` : `${more.length} more`;
  return (
    <div className="relative">
      {rows.map((n, i) => (
        <Node key={n.thread.id} n={n} last={i === rows.length - 1 && !more.length} open={open} spans={spans} variant={variant} agents={agents} onNavigate={onNavigate} />
      ))}
      {more.length > 0 && (
        <div className="tree-node tree-last" data-variant={variant}>
          <button
            type="button"
            onClick={() => (open ? setAll(true) : onOpen?.())}
            className={`item flex w-full min-w-0 items-center gap-1.5 pr-2 pl-3 text-left text-fg-3 hover:text-fg-2 ${ROW[variant]}`}
          >
            <span className="grid w-3 shrink-0 place-items-center">
              <Icon name="chevronRight" size={10} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px]">{moreLabel}</span>
            <TreeTally tally={tallyOf(more)} />
          </button>
        </div>
      )}
    </div>
  );
}

const tallyOf = (nodes: StubNode[]): Tally => ({
  needs: nodes.filter((n) => n.state === 'needs').length,
  failed: nodes.filter((n) => n.state === 'failed' || n.state === 'limited').length,
  running: nodes.filter((n) => !n.finished && n.state !== 'needs' && n.state !== 'failed').length,
  done: nodes.filter((n) => n.finished && n.state !== 'needs' && n.state !== 'failed' && n.state !== 'limited').length,
});

function Node({
  n,
  last,
  open,
  spans,
  variant,
  agents,
  onNavigate,
}: {
  n: StubNode;
  last: boolean;
  open: boolean;
  spans: boolean;
  variant: TreeVariant;
  agents?: readonly BackgroundTask[];
  onNavigate?: () => void;
}) {
  const { channels } = useApp();
  const now = useNow(60_000);
  const t = n.thread;
  const title = t.title || 'Untitled';
  const channel = t.channel_id === 'conductor' ? 'Conductor' : (channels.find((c) => c.id === t.channel_id)?.name ?? t.channel_id);
  const mine = (agents ?? []).filter((k) => k.thread_id === t.id && k.subagent);
  const tip = [title, t.harness && harnessLabel(t.harness), t.model, `#${channel}`, n.state === 'needs' ? 'Needs you' : statusLabel(n.state)].filter(Boolean).join(' · ');
  const phone = variant === 'phone';
  return (
    <div className={`tree-node ${last ? 'tree-last' : ''}`} data-variant={variant} data-tree-state={n.state}>
      <a
        href={href.thread(t.id)}
        onClick={onNavigate}
        title={tip}
        aria-label={tip}
        className={`item group/tn flex min-w-0 items-center gap-1.5 pr-2 pl-3 ${ROW[variant]} ${phone ? 'text-fg-2' : 'text-fg-3 hover:text-fg'}`}
      >
        <span className="mr-0.5 grid w-3 shrink-0 place-items-center">
          {n.state === 'running' ? <Loader size={11} className="text-live-text" /> : t.done_at ? <DoneMark size={7} /> : <StatusDot status={n.state} size={7} />}
        </span>
        {t.harness && (
          <span className="shrink-0 text-fg-2">
            <HarnessLogo harness={t.harness} size={phone ? 13 : 12} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {spans && <span className={`max-w-[40%] shrink-0 truncate text-[11px] text-fg-3 ${t.model && !phone ? 'group-hover/tn:hidden' : ''}`}>#{channel}</span>}
        {t.model && !phone && <span className="hidden max-w-[50%] shrink-0 truncate font-mono text-[10.5px] text-fg-3 group-hover/tn:inline">{t.model}</span>}
        {phone && !spans && <span className="shrink-0 font-num text-[12px] text-fg-3 tabular-nums">{relTime(t.updated_at ?? t.created_at, now)}</span>}
      </a>
      {n.children.length > 0 && (
        <div className="ml-5">
          <Level nodes={n.children} open={open} spans={false} variant={variant} agents={agents} onNavigate={onNavigate} />
        </div>
      )}
      {mine.length > 0 && (
        <div className="ml-5">
          <AgentRows tasks={mine} variant={variant} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

/** A thread's running sub-agents on the tree line. On the phone, one row says how many. */
export function AgentRows({ tasks, variant, onNavigate }: { tasks: readonly BackgroundTask[]; variant: TreeVariant; onNavigate?: () => void }) {
  const now = useNow(1000);
  if (variant === 'phone')
    return (
      <div className="tree-node tree-last" data-variant={variant}>
        <a href={href.thread(tasks[0].thread_id)} onClick={onNavigate} className={`item flex items-center gap-1.5 pr-2 pl-3 text-fg-3 ${ROW.phone} text-[13px]`}>
          <span className="mr-0.5 grid w-3 shrink-0 place-items-center">
            <Loader size={10} className="text-live-text" />
          </span>
          <Icon name="layers" size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{plural(tasks.length, 'agent')} running</span>
        </a>
      </div>
    );
  return (
    <>
      {tasks.map((k, i) => (
        <div key={k.task_id} className={`tree-node ${i === tasks.length - 1 ? 'tree-last' : ''}`} data-variant={variant}>
          <a
            href={href.thread(k.thread_id)}
            onClick={onNavigate}
            title={[k.description, k.subagent_type, k.tool_uses ? plural(k.tool_uses, 'tool') : null].filter(Boolean).join(' · ')}
            className={`item flex min-w-0 items-center gap-1.5 pr-2 pl-3 text-[12px] text-fg-3 hover:text-fg ${ROW[variant]}`}
          >
            <span className="mr-0.5 grid w-3 shrink-0 place-items-center">
              <Loader size={10} className="text-live-text" />
            </span>
            <Icon name="layers" size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{k.description}</span>
            <span className="shrink-0 font-num text-[11px] text-fg-3 tabular-nums">{duration(Math.max(0, now - toDate(k.started_at).getTime()))}</span>
          </a>
        </div>
      ))}
    </>
  );
}
