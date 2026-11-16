import type { TurnPhase } from '@omni/shared/status.ts';
import { useState, type ReactNode } from 'react';
import type { Thread } from '../../api.ts';
import type { PanelTab } from '../../pages/useThreadSession.ts';
import { HarnessMark, harnessLabel } from '../brand.tsx';
import { useThreadAccount } from '../../accounts.ts';
import { threadAccountLine } from '@omni/shared/harness-accounts.ts';
import { Chip, copyText, Icon, IconButton, IconLink, StatusDot, type ChipTone, type IconName } from '../ui.tsx';
import { plural } from '../../format.ts';
import { machineLabel } from '@omni/shared/handoff.ts';
import { prBadge, prLine, STEP_WORKING, type PRStep } from '@omni/shared/thread-glance.ts';
import { threadPill } from './thread-state.ts';
import { runningLabel } from '@omni/shared/goal.ts';
import { useHereName, useNeedOf, useNow } from '../../store.tsx';
import { cloudAgentUrl } from '@omni/shared/cloud-agent.ts';
import { shortPath } from '@omni/shared/short-path.ts';
import type { ThreadPRs } from './panel/PRsTab.tsx';
import type { InitP } from './panel/DetailsTab.tsx';
import { CAPTION, CARD_PAD, DIVIDER, ROW } from './panel/inset.ts';

function QuickRow({
  icon,
  children,
  onClick,
  label,
  disabled,
  trailing,
}: {
  /** The leading glyph. A row without one starts its content in the icon column. */
  icon?: IconName;
  children: ReactNode;
  onClick?: () => void;
  label?: string;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  const body = (
    <>
      {icon && <Icon name={icon} size={15} className={`shrink-0 ${disabled ? 'text-fg-disabled' : 'text-fg-3'}`} />}
      <span className={`flex min-w-0 flex-1 items-center gap-[var(--sp-4)] ${disabled ? 'text-fg-disabled' : 'text-fg'}`}>{children}</span>
      {onClick && !disabled && !trailing && <Icon name="chevronRight" size={13} className="shrink-0 text-fg-3" />}
    </>
  );
  const cls = `flex w-full min-w-0 items-center gap-[var(--sp-5)] ${ROW} text-left text-[12.5px]`;
  const row =
    onClick && !disabled ? (
      <button type="button" aria-label={label} onClick={onClick} className={`hov ${cls} [--hov:var(--bg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-line-strong`}>
        {body}
      </button>
    ) : (
      <div className={cls}>{body}</div>
    );
  // A trailing button sits beside the row's own, never inside it.
  return trailing ? (
    <div className="flex min-w-0 items-center gap-[var(--sp-1)]">
      <div className="min-w-0 flex-1">{row}</div>
      {trailing}
    </div>
  ) : (
    row
  );
}

/**
 * A compact glance at the thread beside the transcript: machine, checkout, harness, run state, branch, a door into the
 * full inspector, and the PRs the thread and its crew opened. Desktop gives it a narrow column right of the transcript;
 * the phone opens it from the header.
 */
export function ThreadQuickCard({
  thread,
  init,
  warm,
  slotBusy,
  prs,
  step,
  artifactCount,
  machineName,
  cwd,
  onOpen,
  onOpenPR,
  asking = false,
  turn,
  reconnecting = false,
  className = '',
}: {
  thread: Thread;
  init: InitP | null;
  warm: boolean | undefined;
  slotBusy: boolean;
  /** The thread's own PRs and its crew's, from GET /threads/:id/pr (useThreadPR). */
  prs: ThreadPRs;
  step: PRStep | null;
  artifactCount: number;
  machineName: string | undefined;
  cwd: string;
  /** Opens the full inspector on `tab`; the phone opens the matching thread screen. */
  onOpen: (tab: PanelTab) => void;
  /** Opens Omni's page for a PR. */
  onOpenPR: (channelId: string, n: number) => void;
  /** The agent waits on a question card: the turn is open, but on Ben. */
  asking?: boolean;
  /** What the running turn is doing, for the run row's dot. */
  turn?: TurnPhase | null;
  reconnecting?: boolean;
  className?: string;
}) {
  const cloud = thread.harness === 'cursor-cloud';
  const remote = thread.harness === 'hermes' || cloud;
  const cloudUrl = cloud ? cloudAgentUrl(thread.session_id) : null;
  const model = thread.model || init?.model;
  const now = useNow(60_000);
  // The run row says what the header pill says, except that a turn in progress reads as one.
  const need = useNeedOf(thread.id);
  const pill = threadPill(thread, { asking, reconnecting, now, turn, need, pr: prs?.pr });
  const run = reconnecting || asking || !slotBusy ? { ...pill, label: asking ? 'Waiting on you' : pill.label } : { glyph: 'running' as const, label: runningLabel(thread, 'Turn running'), phase: pill.phase, mark: pill.phase ?? ('working' as const) };
  const branchDisabled = !thread.branch;
  // The account its harness ran as when its process last started (apps/server/harness-accounts.ts), here or elsewhere.
  const ran = useThreadAccount(thread.id);
  const hereName = useHereName();

  return (
    <section
      aria-label="Thread quick actions"
      className={`w-full rounded-[var(--r-lg)] border border-line bg-surface ${CARD_PAD} shadow-[inset_0_0_0_1px_light-dark(transparent,var(--pane-edge))] ${className}`}
    >
      <QuickRow icon="monitor">
        <span className="min-w-0 truncate">{machineLabel(machineName)}</span>
        {thread.task_id && <span className="shrink-0 font-num text-[10px] text-fg-3">{thread.task_id}</span>}
      </QuickRow>
      {cloud && cloudUrl ? (
        <QuickRow icon="external" label="Open in Cursor" onClick={() => window.open(cloudUrl, '_blank', 'noopener,noreferrer')}>
          <span className="truncate">Open in Cursor</span>
        </QuickRow>
      ) : (
        <QuickRow
          icon="folder"
          disabled={remote}
          label={remote ? undefined : 'Show working directory in details'}
          onClick={remote ? undefined : () => onOpen('details')}
          trailing={!remote && cwd ? <CopyPath path={cwd} /> : undefined}
        >
          <span className="min-w-0 truncate font-mono text-[11.5px]">{remote ? (cloud ? 'Cursor cloud' : 'Remote session') : shortPath(cwd)}</span>
        </QuickRow>
      )}
      <div className="my-[var(--sp-2)] h-px bg-line" />
      <QuickRow icon="info" label="Harness and model">
        <span className="shrink-0 whitespace-nowrap">
          <HarnessMark harness={thread.harness} withLabel />
        </span>
        {model ? <span className="min-w-0 truncate text-fg-3">{model}</span> : <span className="text-fg-3">default model</span>}
      </QuickRow>
      {ran && (
        <QuickRow icon="user">
          <span className="min-w-0 truncate" title={`${harnessLabel(ran.harness)} ran as ${ran.label}${ran.org ? ` (${ran.org})` : ''} on ${ran.machineName}`}>
            {threadAccountLine(ran, hereName)}
          </span>
        </QuickRow>
      )}
      <QuickRow icon={run.glyph === 'running' ? 'zap' : 'clock'}>
        <StatusDot mark={run.mark} size={8} />
        <span className="truncate">
          {run.label}
          {warm !== undefined && !remote && !reconnecting && (
            <span className="text-fg-3"> · {warm ? 'Live session' : 'Cold start next message'}</span>
          )}
        </span>
      </QuickRow>
      {branchDisabled ? (
        <QuickRow icon="branch" disabled>
          <span className="text-fg-3">No branch</span>
        </QuickRow>
      ) : (
        <QuickRow icon="branch" onClick={() => onOpen('details')} label="Branch details">
          <span className="min-w-0 truncate font-mono text-[11.5px]">{thread.branch}</span>
        </QuickRow>
      )}
      {artifactCount > 0 && (
        <QuickRow icon="layers" onClick={() => onOpen('artifacts')} label="Artifacts">
          <span>{plural(artifactCount, 'artifact')}</span>
        </QuickRow>
      )}
      <div className={DIVIDER}>
        <QuickRow icon="panel" onClick={() => onOpen('details')} label="Open full inspector">
          <span className="font-medium">All details</span>
        </QuickRow>
      </div>
      <PullRequests thread={thread} prs={prs} step={step} onOpen={onOpen} onOpenPR={onOpenPR} />
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
      className="mr-[var(--sp-2)] h-7 w-7 shrink-0"
      onClick={() => {
        void copyText(path).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    />
  );
}

/** One PR in the card: the thread's own, with what blocks it, or one its crew opened. */
type CardPR = { key: string; channelId: string; number: number; title: string; url: string; state: { label: string; tone: ChipTone }; open: boolean };

/** How many PRs the card lists before it hands the rest to the PRs tab. */
const SHOWN = 5;

/** The thread's PRs, then the ones its crew opened: open before merged, newest first, nothing listed twice. */
export function cardPRs(thread: Pick<Thread, 'channel_id'>, prs: NonNullable<ThreadPRs>): CardPR[] {
  const own: CardPR[] = prs.prs.map((p) => {
    const badge = prBadge(p);
    const line = prLine(p);
    const blocked = line.tone === 'needs' && badge.label === 'open';
    return {
      key: p.url || `own-${p.number}`,
      channelId: thread.channel_id,
      number: p.number,
      title: p.title,
      url: p.url,
      state: blocked ? { label: 'blocked', tone: 'needs' } : badge,
      open: (p.state ?? 'OPEN') === 'OPEN',
    };
  });
  const seen = new Set(own.map((p) => p.url));
  const crew: CardPR[] = [...prs.crew]
    .reverse()
    .filter((p) => !seen.has(p.url))
    .map((p) => ({ key: p.url, channelId: p.channel_id, number: p.number, title: p.title, url: p.url, state: prBadge(p), open: p.state === 'OPEN' }));
  const all = [...own, ...crew];
  return [...all.filter((p) => p.open), ...all.filter((p) => !p.open)];
}

/**
 * The PRs this thread and the threads it delegated opened, each with its number, title and state. A row opens Omni's
 * page for the PR and the arrow beside it opens it on GitHub. The heading opens the PRs tab, where the rest of a long
 * list and the merge steps live.
 */
function PullRequests({ thread, prs, step, onOpen, onOpenPR }: { thread: Thread; prs: ThreadPRs; step: PRStep | null; onOpen: (tab: PanelTab) => void; onOpenPR: (channelId: string, n: number) => void }) {
  const list = prs ? cardPRs(thread, prs) : [];
  const shown = list.slice(0, SHOWN);
  const more = list.length - shown.length;
  return (
    <section aria-label="Pull requests" className={DIVIDER}>
      <button type="button" onClick={() => onOpen('prs')} className={`hov flex w-full items-center rounded-[var(--r-sm)] ${CAPTION} text-left text-[11px] text-fg-3 [--hov:var(--bg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-line-strong`}>
        Pull requests
        {list.length > 0 && (
          <span className="ml-auto font-num tabular-nums" title={`${list.filter((p) => p.open).length} open`}>
            {list.length}
          </span>
        )}
      </button>
      {prs === undefined ? (
        <QuickRow icon="pr" disabled>
          <span className="text-fg-3">Checking PRs…</span>
        </QuickRow>
      ) : shown.length === 0 ? (
        <QuickRow icon="pr" disabled>
          <span className="text-fg-3">{step === 'open' ? `${STEP_WORKING.open}…` : 'No PRs yet'}</span>
        </QuickRow>
      ) : (
        shown.map((p) => (
          <QuickRow
            key={p.key}
            label={`Open PR #${p.number}: ${p.title}`}
            onClick={() => onOpenPR(p.channelId, p.number)}
            trailing={p.url ? <IconLink href={p.url} icon="external" label={`Open #${p.number} on GitHub`} size={13} external newTab className="mr-[var(--sp-2)] h-7 w-7" /> : undefined}
          >
            <span className="shrink-0 font-num text-fg-3 tabular-nums">#{p.number}</span>
            <span className="min-w-0 flex-1 truncate" title={p.title}>
              {p.title}
            </span>
            <Chip tone={p.state.tone}>{p.state.label}</Chip>
          </QuickRow>
        ))
      )}
      {more > 0 && (
        <QuickRow icon="more" label="All pull requests" onClick={() => onOpen('prs')}>
          <span className="text-fg-3">{more} more</span>
        </QuickRow>
      )}
    </section>
  );
}
