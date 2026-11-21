import type { TurnPhase } from '@omni/shared/status.ts';
import { useMemo, useState, type ReactNode } from 'react';
import { connectorsUsed, type ConnectorUse } from '@omni/shared/connectors.ts';
import { buildItems, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';
import { ConnectorMark } from '../ConnectorMark.tsx';
import type { Thread } from '../../api.ts';
import type { PanelTab } from '../../pages/useThreadSession.ts';
import { HarnessLogo, HarnessMark, harnessLabel } from '../brand.tsx';
import { useThreadAccount } from '../../accounts.ts';
import { threadAccountLine } from '@omni/shared/harness-accounts.ts';
import { Chip, CopyStatus, Icon, IconButton, IconLink, Loader, statusLabel, StatusDot, ThreadDot, useCopy, type ChipTone, type IconName } from '../ui.tsx';
import { plural } from '../../format.ts';
import { machineLabel } from '@omni/shared/handoff.ts';
import { prBadge, prLine, STEP_WORKING, type PRStep } from '@omni/shared/thread-glance.ts';
import { agentShows } from '@omni/shared/crew-eyes.ts';
import { threadPill } from './thread-state.ts';
import { eyesFor } from '@omni/shared/crew-eyes.ts';
import { runningLabel } from '@omni/shared/goal.ts';
import { useChannel, useCrewRoles, useHereName, useNeedOf, useNow } from '../../store.tsx';
import { cloudAgentUrl } from '@omni/shared/cloud-agent.ts';
import { shortPath } from '@omni/shared/short-path.ts';
import type { ThreadPRs } from './panel/PRsTab.tsx';
import type { InitP } from './panel/DetailsTab.tsx';
import { CAPTION, CARD_PAD, DIVIDER, ROW } from './panel/inset.ts';
import { NO_CREW_ROLE } from '@omni/shared/thread-owner.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import { OwnerField } from './OwnerField.tsx';
import { MembersLine } from './Members.tsx';
import { AgentAvatar, useAgent } from '../AgentAvatar.tsx';
import { markLabel, term } from '@omni/shared/display.ts';
import { useTechnical } from '../../display.ts';
import { isWorking } from '@omni/shared/delegate-count.ts';
import { runElapsed } from '@omni/shared/ran-on.ts';
import { isRemoteHarnessId } from '@omni/shared/custom-harness.ts';
import { isRemoteAgentHarness, remoteFiles, remoteLedCheckout, remoteReadsOpen } from '@omni/shared/remote-agent.ts';

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
 * full inspector, the thread's lineage and the PRs the thread and its crew opened. Desktop gives it a narrow column right
 * of the transcript; the phone opens it from the header.
 *
 * Show technical details only changes what the rows carry. Off, the card keeps the machine, owner, agent, the AI app,
 * the run in plain words, the files, the lineage and any PRs, and leaves out the task id, the working directory, the
 * model id, the account and plan, and whether the session is warm.
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
  parent = null,
  delegated = [],
  onOpenThread,
  asking = false,
  turn,
  reconnecting = false,
  code = true,
  connectors = [],
  className = '',
}: {
  thread: Thread;
  /** The outside connectors its loaded turns called (useThreadConnectors), listed under Connectors. */
  connectors?: ConnectorUse[];
  /**
   * Show technical details is on, or the channel has a repo: the card lists the branch and its Pull requests section
   * even while it has none. Outside a repo with the switch off, it lists PRs only when the thread's crew opened some.
   */
  code?: boolean;
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
  /** The thread that delegated this one, for the lineage. */
  parent?: Thread | null;
  /** The threads this one delegated: the working ones lead the lineage, the rest fold under Previous agents. */
  delegated?: Thread[];
  /** Opens a thread from the lineage. */
  onOpenThread: (id: string) => void;
  /** The agent waits on a question card: the turn is open, but on Ben. */
  asking?: boolean;
  /** What the running turn is doing, for the run row's dot. */
  turn?: TurnPhase | null;
  reconnecting?: boolean;
  className?: string;
}) {
  const cloud = thread.harness === 'cursor-cloud';
  // A remote agent leads (ADR 0020): its rows match a local thread's, its checkout's folder and branch filled in from
  // the start (Q31), and the ones that do not apply to it, its model, empty (Q57).
  const remoteLead = isRemoteAgentHarness(thread.harness) && !!thread.role;
  const remote = isRemoteHarnessId(thread.harness) && !remoteLedCheckout(thread);
  const cloudUrl = cloud ? cloudAgentUrl(thread.session_id) : null;
  const model = thread.model || init?.model;
  const now = useNow(60_000);
  const technical = useTechnical();
  // The run row says what the header pill says, except that a turn in progress reads as one.
  const need = useNeedOf(thread.id);
  const pill = threadPill(thread, { asking, reconnecting, now, turn, need, pr: prs?.pr });
  const run = reconnecting || asking || !slotBusy ? { ...pill, label: asking ? markLabel('question', technical) : pill.label } : { glyph: 'running' as const, label: runningLabel(thread, term('turnRunning', technical)), phase: pill.phase, mark: pill.phase ?? ('working' as const) };
  const branchDisabled = !thread.branch;
  // The account its harness ran as when its process last started (apps/server/harness-accounts.ts), here or elsewhere.
  const ran = useThreadAccount(thread.id);
  const hereName = useHereName();
  const crew = useCrewRoles();
  // Who it is for and who does it, as separate rows (thread-owner.ts); the harness has its own row below.
  const agent = crewRoleName(thread.role, crew);
  const look = useAgent(thread.role);
  // A group thread (ADR 0019): the thread's own agent leads, and the Members row names the others.
  const group = (thread.members ?? []).some((m) => !m.lead);
  // The lead's eyes say what the header's say, thinking included, though the card is no place for its loops (ADR 0021).
  const leadEyes = { eyes: eyesFor(agentShows(thread.members, thread.role, pill.mark), true) };
  const ch = useChannel(thread.channel_id);

  return (
    <section
      aria-label="Thread quick actions"
      className={`w-full rounded-[var(--r-lg)] border border-line bg-surface ${CARD_PAD} shadow-[inset_0_0_0_1px_light-dark(transparent,var(--pane-edge))] ${className}`}
    >
      <QuickRow icon="monitor">
        <span className="min-w-0 truncate">{machineLabel(machineName)}</span>
        {technical && thread.task_id && <span className="shrink-0 font-num text-[10px] text-fg-3">{thread.task_id}</span>}
      </QuickRow>
      {cloud && cloudUrl ? (
        <QuickRow icon="external" label="Open in Cursor" onClick={() => window.open(cloudUrl, '_blank', 'noopener,noreferrer')}>
          <span className="truncate">Open in Cursor</span>
        </QuickRow>
      ) : !technical ? null : (
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
      <QuickRow icon="target">
        <span className="shrink-0 text-fg-3">Owner</span>
        <OwnerField thread={thread} className="flex-1" />
      </QuickRow>
      <QuickRow icon="delegate">
        <span className="shrink-0 text-fg-3">{group ? 'Lead' : 'Agent'}</span>
        {look && agent && <AgentAvatar agent={{ ...look, name: agent }} size={18} shows={leadEyes} placement="row" />}
        <span className={`min-w-0 truncate ${agent ? '' : 'text-fg-3'}`}>{agent ?? NO_CREW_ROLE}</span>
      </QuickRow>
      {group && (
        <QuickRow icon="user">
          <span className="shrink-0 text-fg-3">Members</span>
          <MembersLine thread={thread} />
        </QuickRow>
      )}
      {remoteLead ? (
        <>
          <QuickRow icon="info" label={term('harnessAndModel', technical)}>
            <span className="shrink-0 text-fg-3">{technical ? 'Model' : 'Runs on'}</span>
          </QuickRow>
          <QuickRow icon="lock" label="Files">
            <span className="shrink-0 text-fg-3">Files</span>
            <span className="min-w-0 truncate" data-files-row>
              {remoteFiles(remoteReadsOpen(ch))}
            </span>
          </QuickRow>
        </>
      ) : (
        <QuickRow icon="info" label={term('harnessAndModel', technical)}>
          <span className="shrink-0 whitespace-nowrap">
            <HarnessMark harness={thread.harness} withLabel />
          </span>
          {!technical ? null : model ? <span className="min-w-0 truncate text-fg-3">{model}</span> : <span className="text-fg-3">default model</span>}
        </QuickRow>
      )}
      {technical && ran && (
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
          {technical && warm !== undefined && !remote && !reconnecting && (
            <span className="text-fg-3"> · {warm ? 'Live session' : 'Cold start next message'}</span>
          )}
        </span>
      </QuickRow>
      {!code ? null : branchDisabled ? (
        <QuickRow icon="branch" disabled>
          <span className="text-fg-3">No branch</span>
        </QuickRow>
      ) : (
        <QuickRow icon="branch" onClick={() => onOpen('details')} label="Branch details">
          <span className="min-w-0 truncate font-mono text-[11.5px]">{thread.branch}</span>
        </QuickRow>
      )}
      {artifactCount > 0 && (
        <QuickRow icon="layers" onClick={() => onOpen('artifacts')} label="Files">
          <span>{plural(artifactCount, 'file')}</span>
        </QuickRow>
      )}
      <div className={DIVIDER}>
        <QuickRow icon="panel" onClick={() => onOpen('details')} label="Open full inspector">
          <span className="font-medium">All details</span>
        </QuickRow>
      </div>
      <Lineage parent={parent} delegated={delegated} onOpenThread={onOpenThread} />
      <Connectors used={connectors} live={slotBusy} />
      {(code || (prs && cardPRs(thread, prs).length > 0)) && <PullRequests thread={thread} prs={prs} step={step} onOpen={onOpen} onOpenPR={onOpenPR} />}
    </section>
  );
}

/** The outside connectors a thread's loaded turns called, in first-use order: one pass over the events, kept until they change. */
export function useThreadConnectors(events: TranscriptEvent[]): ConnectorUse[] {
  return useMemo(() => connectorsUsed(buildItems(events).items.flatMap((it) => (it.type === 'tools' ? it.calls : []))), [events]);
}

/**
 * The apps the thread reached through a connector, like the Context list in Claude's apps: each one's tile and name, and
 * "Connector" on the right, or a loader while one of its calls runs. Absent while it used none.
 */
function Connectors({ used, live }: { used: ConnectorUse[]; live: boolean }) {
  if (!used.length) return null;
  return (
    <section aria-label="Connectors" className={DIVIDER}>
      <div className={`flex items-center ${CAPTION} text-[11px] text-fg-3`}>Connectors</div>
      {used.map((u) => (
        <QuickRow key={u.connector.id}>
          <ConnectorMark connector={u.connector} size={20} />
          <span className="min-w-0 flex-1 truncate">{u.connector.name}</span>
          {live && u.running > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-fg-3">
              In use <Loader size={11} />
            </span>
          ) : (
            <span className="shrink-0 text-[11.5px] text-fg-3" title={`${plural(u.calls, 'call')}${u.failed ? `, ${u.failed} failed` : ''}`}>
              Connector
            </span>
          )}
        </QuickRow>
      ))}
    </section>
  );
}

function CopyPath({ path }: { path: string }) {
  const { state, copy, icon } = useCopy();
  return (
    <>
      <IconButton icon={icon} label="Copy the working directory path" size={13} className="mr-[var(--sp-2)] h-7 w-7 shrink-0" onClick={() => void copy(path)} />
      <CopyStatus state={state} />
    </>
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
  const crew: CardPR[] = prs.crew
    .toReversed()
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

/** The lineage's two lists: the delegated threads at work now, in the order they started, and the rest, newest first. */
export function lineageOf(delegated: readonly Thread[]): { running: Thread[]; previous: Thread[] } {
  const running = delegated.filter(isWorking);
  const previous = delegated.filter((c) => !isWorking(c)).sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  return { running, previous };
}

/** A thread's harness logo with its status mark on the corner, as the inspector's agents card marks every agent. */
function LineageMark({ t }: { t: Thread }) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center text-fg-3">
      <HarnessLogo harness={t.harness ?? 'claude-code'} size={15} title={harnessLabel(t.harness ?? 'claude-code')} />
      <span className="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-surface p-px">
        <ThreadDot t={t} size={6} faces={false} />
      </span>
    </span>
  );
}

const lineageRow = `hov flex w-full min-w-0 items-center gap-[var(--sp-5)] ${ROW} text-left text-[12.5px] [--hov:var(--bg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-line-strong`;

/** One delegated thread: its mark, title and how long it has run (while it runs), opening the thread. */
function LineageRow({ t, onOpenThread }: { t: Thread; onOpenThread: (id: string) => void }) {
  const now = useNow(1000);
  const side = isWorking(t) ? (runElapsed(t, now) ?? statusLabel(t.status)) : null;
  return (
    <button type="button" title={t.title || 'Untitled'} aria-label={`Open ${t.title || 'Untitled'}`} onClick={() => onOpenThread(t.id)} className={lineageRow}>
      <LineageMark t={t} />
      <span className="min-w-0 flex-1 truncate">{t.title || 'Untitled'}</span>
      {side && <span className="shrink-0 font-num text-[11px] text-fg-3 tabular-nums">{side}</span>}
    </button>
  );
}

/**
 * Where the thread sits among the threads it came from and handed work to: the thread that delegated it, then the
 * threads it delegated that work now, each with a live mark and how long it has run, and the finished ones folded under
 * Previous agents. Every row opens its thread. Shown with Show technical details on or off; nothing when the thread
 * stands alone.
 */
function Lineage({ parent, delegated, onOpenThread }: { parent: Thread | null; delegated: Thread[]; onOpenThread: (id: string) => void }) {
  const [showPrev, setShowPrev] = useState(false);
  const { running, previous } = lineageOf(delegated);
  if (!parent && !delegated.length) return null;
  return (
    <section aria-label="Lineage" className={DIVIDER}>
      <div className={`flex items-center ${CAPTION} text-[11px] text-fg-3`}>
        Lineage
        {running.length > 0 && <span className="font-num tabular-nums">&nbsp;· {running.length} running</span>}
      </div>
      {parent && (
        <button type="button" title={`Back to the thread that delegated this one: ${parent.title}`} onClick={() => onOpenThread(parent.id)} className={lineageRow}>
          <span className="grid size-5 shrink-0 place-items-center text-fg-3">
            <Icon name="arrowUpRight" size={14} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="text-fg-3">From </span>
            {parent.title || 'Untitled'}
          </span>
          <span className="shrink-0 text-[11px] text-fg-3">{statusLabel(parent.status)}</span>
        </button>
      )}
      {running.map((c) => (
        <LineageRow key={c.id} t={c} onOpenThread={onOpenThread} />
      ))}
      {previous.length > 0 && (
        <>
          <button type="button" aria-expanded={showPrev} onClick={() => setShowPrev((v) => !v)} className={`${lineageRow} text-fg-2`}>
            <span className="grid size-5 shrink-0 place-items-center text-fg-3">
              <Icon name="delegate" size={15} />
            </span>
            <span className="flex-1">Previous agents</span>
            <span className="font-num text-[11px] text-fg-3 tabular-nums">{previous.length}</span>
            <Icon name="chevronRight" size={13} className={`shrink-0 text-fg-3 transition-transform ${showPrev ? 'rotate-90' : ''}`} />
          </button>
          {showPrev && previous.map((c) => <LineageRow key={c.id} t={c} onOpenThread={onOpenThread} />)}
        </>
      )}
    </section>
  );
}
