import { useState, type ReactNode } from 'react';
import type { BackgroundTask, Thread } from '../../api.ts';
import type { PanelTab } from '../../pages/useThreadSession.ts';
import { HarnessMark, Loader } from '../brand.tsx';
import { Chip, copyText, Icon, IconButton, STATUS_LABEL, StatusDot, type IconName } from '../ui.tsx';
import { plural } from '../../format.ts';
import { machineLabel } from '@omni/shared/handoff.ts';
import { prBadge, prLine, STEP_WORKING, type PRStep } from '@omni/shared/thread-glance.ts';
import { isWorking, shownStatus } from '@omni/shared/delegate-count.ts';
import { toDate } from '@omni/shared/format.ts';
import { duration } from '../../format.ts';
import { useNow } from '../../store.tsx';
import { subagentKind, subagentTip } from '../../subagents.ts';
import { cloudAgentUrl } from '@omni/shared/cloud-agent.ts';
import { shortPath } from '@omni/shared/short-path.ts';
import type { ThreadPRs } from './panel/PRsTab.tsx';
import type { InitP } from './panel/DetailsTab.tsx';

function QuickRow({
  icon,
  children,
  onClick,
  label,
  disabled,
  trailing,
}: {
  icon: IconName;
  children: ReactNode;
  onClick?: () => void;
  label?: string;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  const body = (
    <>
      <Icon name={icon} size={15} className={`shrink-0 ${disabled ? 'text-fg-4' : 'text-fg-3'}`} />
      <span className={`flex min-w-0 flex-1 items-center gap-2 ${disabled ? 'text-fg-4' : 'text-fg'}`}>{children}</span>
      {trailing}
      {onClick && !disabled && <Icon name="chevronRight" size={13} className="shrink-0 text-fg-4" />}
    </>
  );
  const cls = 'flex min-h-[36px] w-full min-w-0 items-center gap-2.5 rounded-[11px] px-2 text-left text-[12.5px]';
  if (onClick && !disabled) {
    return (
      <button type="button" aria-label={label} onClick={onClick} className={`hov ${cls} [--hov:var(--bg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-line-strong`}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

/**
 * A compact glance at the thread beside the transcript: machine, checkout, harness, run state, branch work, and a door
 * into the full inspector. Desktop gives it a narrow column right of the transcript; the phone opens it from the header.
 */
export function ThreadQuickCard({
  thread,
  init,
  warm,
  slotBusy,
  agents,
  parent,
  children,
  prs,
  step,
  artifactCount,
  machineName,
  cwd,
  onOpen,
  onOpenThread,
  onJump,
  className = '',
}: {
  thread: Thread;
  init: InitP | null;
  warm: boolean | undefined;
  slotBusy: boolean;
  agents: BackgroundTask[];
  /** The thread that delegated this one, for the lineage. */
  parent: Thread | null;
  /** Threads this one delegated; the working ones join the lineage. */
  children: Thread[];
  prs: ThreadPRs;
  step: PRStep | null;
  artifactCount: number;
  machineName: string | undefined;
  cwd: string;
  /** Opens the full inspector on `tab`; the phone opens the matching thread screen. */
  onOpen: (tab: PanelTab) => void;
  onOpenThread: (id: string) => void;
  /** Scrolls the transcript to the call that started a sub-agent. */
  onJump: (eventId: number) => void;
  className?: string;
}) {
  const cloud = thread.harness === 'cursor-cloud';
  const remote = thread.harness === 'hermes' || cloud;
  const cloudUrl = cloud ? cloudAgentUrl(thread.session_id) : null;
  const pr = prs?.pr ?? null;
  const badge = pr ? prBadge(pr) : null;
  const line = pr ? prLine(pr) : null;
  const model = thread.model || init?.model;
  const status = shownStatus(thread);
  const branchDisabled = !thread.branch;

  return (
    <section
      aria-label="Thread quick actions"
      className={`w-full rounded-[18px] border border-line bg-surface p-1.5 shadow-[inset_0_0_0_1px_light-dark(transparent,var(--pane-edge))] ${className}`}
    >
      <QuickRow
        icon="monitor"
        trailing={!remote && cwd ? <CopyPath path={cwd} /> : undefined}
      >
        <span className="min-w-0 truncate">{machineLabel(machineName)}</span>
        {thread.task_id && <span className="shrink-0 font-num text-[10px] text-fg-4">{thread.task_id}</span>}
      </QuickRow>
      {cloud && cloudUrl ? (
        <QuickRow icon="external" label="Open in Cursor" onClick={() => window.open(cloudUrl, '_blank', 'noopener,noreferrer')}>
          <span className="truncate">Open in Cursor</span>
        </QuickRow>
      ) : (
        <QuickRow icon="folder" disabled={remote} label={remote ? undefined : 'Show working directory in details'} onClick={remote ? undefined : () => onOpen('details')}>
          <span className="min-w-0 truncate font-mono text-[11.5px]">{remote ? (cloud ? 'Cursor cloud' : 'Remote session') : shortPath(cwd)}</span>
        </QuickRow>
      )}
      <div className="my-0.5 h-px bg-line" />
      <QuickRow icon="info" label="Harness and model">
        <span className="shrink-0 whitespace-nowrap">
          <HarnessMark harness={thread.harness} withLabel />
        </span>
        {model ? <span className="min-w-0 truncate text-fg-3">{model}</span> : <span className="text-fg-4">default model</span>}
      </QuickRow>
      <QuickRow icon={slotBusy ? 'zap' : 'clock'}>
        <StatusDot status={slotBusy ? 'running' : status} size={7} />
        <span className="truncate">
          {slotBusy ? 'Turn running' : (STATUS_LABEL[status] ?? status)}
          {warm !== undefined && !remote && (
            <span className="text-fg-3"> · {warm ? 'Live session' : 'Cold start next message'}</span>
          )}
        </span>
      </QuickRow>
      {branchDisabled ? (
        <QuickRow icon="branch" disabled>
          <span className="text-fg-4">No branch</span>
        </QuickRow>
      ) : (
        <>
          <QuickRow icon="branch" onClick={() => onOpen('details')} label="Branch details">
            <span className="min-w-0 truncate font-mono text-[11.5px]">{thread.branch}</span>
          </QuickRow>
          <QuickRow icon="pr" onClick={() => onOpen('prs')} label="Pull requests">
            {prs === undefined ? (
              <span className="text-fg-3">Checking PR…</span>
            ) : pr && badge && line ? (
              <>
                <span className="shrink-0 font-num tabular-nums">#{pr.number}</span>
                <Chip tone={line.tone === 'needs' ? 'needs' : badge.tone}>{line.tone === 'needs' && badge.label === 'open' ? 'blocked' : badge.label}</Chip>
                <span className="min-w-0 truncate text-fg-3">{line.text}</span>
              </>
            ) : step === 'open' ? (
              <span className="text-fg-3">{STEP_WORKING.open}…</span>
            ) : (
              <span className="text-fg-3">No PR yet</span>
            )}
          </QuickRow>
        </>
      )}
      {artifactCount > 0 && (
        <QuickRow icon="layers" onClick={() => onOpen('artifacts')} label="Artifacts">
          <span>{plural(artifactCount, 'artifact')}</span>
        </QuickRow>
      )}
      <div className="mt-0.5 border-t border-line pt-0.5">
        <QuickRow icon="panel" onClick={() => onOpen('details')} label="Open full inspector">
          <span className="font-medium">All details</span>
        </QuickRow>
      </div>
      <Lineage thread={thread} parent={parent} delegated={children.filter(isWorking)} agents={agents} onOpenThread={onOpenThread} onJump={onJump} />
    </section>
  );
}

function CopyPath({ path }: { path: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      icon={done ? 'check' : 'copy'}
      label={done ? 'Copied' : 'Copy the working directory path'}
      size={13}
      className="h-7 w-7 shrink-0"
      onClick={() => {
        void copyText(path).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    />
  );
}

/** The elbow that hangs a row off the one above it; `last` ends the trunk there. */
function Branch({ last }: { last: boolean }) {
  return (
    <span aria-hidden className="relative w-3 shrink-0 self-stretch">
      <span className="absolute top-0 left-0 h-1/2 w-2.5 rounded-bl-[6px] border-b border-l border-line-strong" />
      {!last && <span className="absolute top-1/2 bottom-0 left-0 border-l border-line-strong" />}
    </span>
  );
}

const treeRow = 'flex h-8 w-full min-w-0 items-center gap-2 rounded-[10px] px-2 text-left text-[12px]';
const treeButton = `hov ${treeRow} [--hov:var(--bg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-line-strong`;

function SubagentLeaf({ t, last, indent, onJump }: { t: BackgroundTask; last: boolean; indent: string; onJump: (eventId: number) => void }) {
  const now = useNow(1000);
  const kind = subagentKind(t);
  const tip = kind ? `${kind}: ${subagentTip(t)}` : subagentTip(t);
  const body = (
    <>
      <Branch last={last} />
      <Loader size={10} className="shrink-0 text-live-text" />
      <span className="min-w-0 flex-1 truncate">{t.description}</span>
      <span className="shrink-0 font-num text-[10.5px] text-fg-3 tabular-nums">{duration(Math.max(0, now - toDate(t.started_at).getTime()))}</span>
    </>
  );
  const id = t.event_id;
  return id ? (
    <button type="button" title={tip} onClick={() => onJump(id)} className={`${treeButton} ${indent}`}>
      {body}
    </button>
  ) : (
    <div title={tip} className={`${treeRow} ${indent}`}>
      {body}
    </div>
  );
}

/**
 * Where the thread sits while agents run under it: the thread that delegated it, the thread itself, and what runs
 * inside it now (delegated threads, then its own sub-agents), drawn as a tree. Nothing while nothing runs.
 */
function Lineage({
  thread,
  parent,
  delegated,
  agents,
  onOpenThread,
  onJump,
}: {
  thread: Thread;
  parent: Thread | null;
  delegated: Thread[];
  agents: BackgroundTask[];
  onOpenThread: (id: string) => void;
  onJump: (eventId: number) => void;
}) {
  const total = delegated.length + agents.length;
  if (!total) return null;
  // What runs hangs from the thread's own dot, one step further in when the thread hangs from its parent.
  const indent = parent ? 'pl-[30px]' : 'pl-[11px]';
  return (
    <section aria-label="Lineage" className="mt-0.5 border-t border-line pt-1">
      <div className="flex items-center px-2 pt-1 pb-0.5 text-[11px] text-fg-3">
        Lineage
        <span className="ml-auto font-num tabular-nums" title={`${plural(total, 'agent')} running`}>
          {total} running
        </span>
      </div>
      {parent && (
        <button type="button" title={`From: ${parent.title}`} onClick={() => onOpenThread(parent.id)} className={treeButton}>
          <Icon name="arrowUpRight" size={13} className="shrink-0 text-fg-3" />
          <span className="min-w-0 flex-1 truncate text-fg-2">{parent.title || 'Untitled'}</span>
          <StatusDot status={parent.status} size={6} />
        </button>
      )}
      <div className={`${treeRow} font-medium`}>
        {parent && <Branch last />}
        <StatusDot status="running" size={7} />
        <span className="min-w-0 flex-1 truncate">{thread.title || 'This thread'}</span>
      </div>
      {delegated.map((c, i) => (
        <button key={c.id} type="button" title={c.title} onClick={() => onOpenThread(c.id)} className={`${treeButton} ${indent}`}>
          <Branch last={i === total - 1} />
          <StatusDot status={c.status} size={6} />
          <span className="min-w-0 flex-1 truncate">{c.title || 'Untitled'}</span>
          <Icon name="chevronRight" size={12} className="shrink-0 text-fg-4" />
        </button>
      ))}
      {agents.map((t, i) => (
        <SubagentLeaf key={t.task_id} t={t} last={delegated.length + i === total - 1} indent={indent} onJump={onJump} />
      ))}
    </section>
  );
}
