import { useState, type ReactNode } from 'react';
import type { BackgroundTask, Channel, Thread } from '../../api.ts';
import type { PanelTab } from '../../pages/useThreadSession.ts';
import { HarnessMark } from '../brand.tsx';
import { Chip, copyText, Icon, IconButton, STATUS_LABEL, StatusDot, type IconName } from '../ui.tsx';
import { plural } from '../../format.ts';
import { machineLabel } from '@omni/shared/handoff.ts';
import { prBadge, prLine, STEP_WORKING, type PRStep } from '@omni/shared/thread-glance.ts';
import { shownStatus } from '@omni/shared/delegate-count.ts';
import { cloudAgentUrl } from '@omni/shared/cloud-agent.ts';
import { shortPath } from '@omni/shared/short-path.ts';
import type { BranchChanges } from './panel/GlanceCard.tsx';
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
  channel,
  init,
  warm,
  slotBusy,
  agents,
  prs,
  changes,
  step,
  artifactCount,
  machineName,
  cwd,
  onOpen,
  className = '',
}: {
  thread: Thread;
  channel: Channel | null | undefined;
  init: InitP | null;
  warm: boolean | undefined;
  slotBusy: boolean;
  agents: BackgroundTask[];
  prs: ThreadPRs;
  changes: BranchChanges;
  step: PRStep | null;
  artifactCount: number;
  machineName: string | undefined;
  cwd: string;
  /** Opens the full inspector on `tab`; the phone opens the matching thread screen. */
  onOpen: (tab: PanelTab) => void;
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
      className={`w-full rounded-[18px] border border-line bg-surface p-1.5 shadow-[0_2px_14px_rgb(0_0_0/0.07),inset_0_0_0_1px_light-dark(transparent,var(--pane-edge))] ${className}`}
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
      <QuickRow icon="play" label="Channel actions" onClick={() => onOpen('actions')}>
        <span className="truncate">Actions</span>
        <span className="ml-auto text-fg-3">#{channel?.name ?? thread.channel_id}</span>
      </QuickRow>
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
        {agents.length > 0 && (
          <span className="ml-auto shrink-0 font-num text-[10.5px] text-fg-3" title={`${plural(agents.length, 'subagent')} running`}>
            {agents.length}
          </span>
        )}
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
          <QuickRow
            icon="diff"
            onClick={() => onOpen('changes')}
            label="Changes"
            trailing={
              changes && changes.files.length > 0 ? (
                <span className="flex shrink-0 gap-1 font-num text-[11px] tabular-nums text-fg-3">
                  <span className="text-fg-2">+{changes.add}</span>
                  <span className="text-fg-4">−{changes.del}</span>
                </span>
              ) : undefined
            }
          >
            {!changes ? (
              <span className="text-fg-3">Changes</span>
            ) : changes.files.length ? (
              <span>{plural(changes.files.length, 'file')} changed</span>
            ) : (
              <span className="text-fg-3">No changes vs base</span>
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
