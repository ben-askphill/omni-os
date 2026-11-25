import type { Mark, TurnPhase } from '@omni/shared/status.ts';
import { agentLook, conductorChannelLook, type FaceShows } from '@omni/shared/agent-avatar.ts';
import { delegationGroups, isBrief, lanePlan, lockedReply, promptCaption, promptRecipients, replyShows, thinkingLabel, turnLive } from '@omni/shared/turn-plan.ts';
import { CONDUCTOR_CHANNEL } from '@omni/shared/channel-icon.ts';
import { laneShows } from '@omni/shared/crew-eyes.ts';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi, type Artifact, type BranchChanges, type Channel, type Thread } from '../api.ts';
import { Attachments, MemberLine, SwitchLine, UserText } from '../components/Transcript.tsx';
import { PRWakeList } from '../components/thread/PRWatch.tsx';
import { QuestionCard } from '../components/thread/QuestionCard.tsx';
import { CloudAgentCard } from '../components/thread/CloudAgentCard.tsx';
import { MergeRiskCard } from '../components/thread/MergeRiskCard.tsx';
import { ClippedNote } from '../components/thread/HistoryEdgeRow.tsx';
import type { useThreadPR } from '../components/thread/ThreadPR.tsx';
import type { AgentLook } from '../components/AgentAvatar.tsx';
import { AuthorLine, REPLY_INDENT } from '../components/AuthorLine.tsx';
import { RemoteLockLine } from '../components/thread/RemoteLockLine.tsx';
import { Avatar, Icon, Segmented } from '../components/ui.tsx';
import { tabPanelProps } from '../components/ui/segmented.tsx';
import { AgentAvatar } from '../components/AgentAvatar.tsx';
import { CollisionFlag, CollisionMark } from '../components/thread/Collision.tsx';
import { ThinkingLine } from '../components/thread/ThinkingLine.tsx';
import { ContextChips, hasContext } from '../message-context/ContextChips.tsx';
import { SentTo } from '../message-context/agent-mention.tsx';
import { changesView } from '@omni/shared/changes-view.ts';
import { atStart } from '@omni/shared/history.ts';
import { href } from '../router.ts';
import { isRenderPath } from '@omni/shared/html-render.ts';
import { HtmlRender } from '../components/HtmlRender.tsx';
import { ArtifactCard, ChangesCard, Clamped, Delegation, MoConnectors, MoProse, MoSteps, NowLine, Outcome, Report, type TurnView } from './ThreadCards.tsx';
import { MoBubble } from './parts.tsx';
import { askCaption } from '@omni/shared/ask.ts';
import { showsSteps } from '@omni/shared/steps.ts';
import { shortTime } from './rows.ts';
import { limitLabel } from '../limits.ts';
import type { useShell, useThread } from './shell.tsx';
import type { ThreadView as ThreadOf } from '@omni/shared/thread-view.ts';
import { isReply, replyAt } from '@omni/shared/transcript-fold.ts';
import { seatRun } from '@omni/shared/members.ts';

/** A worktree thread's changes since its base, again whenever a turn starts or ends. */
export function useBranchChanges(thread: Thread | null, busy: boolean) {
  const res = useApi<BranchChanges>(thread?.branch ? `/threads/${encodeURIComponent(thread.id)}/changes` : null);
  const { reload } = res;
  const last = useRef(busy);
  useEffect(() => {
    if (last.current !== busy) reload();
    last.current = busy;
  }, [busy, reload]);
  return useMemo(() => {
    const v = res.data ? changesView(res.data) : null;
    // What no commit has taken yet: what a remote-led thread's Commit button commits (ADR 0020).
    const uncommitted = res.data?.available ? res.data.groups.filter((g) => g.kind !== 'committed').reduce((n, g) => n + g.files.length, 0) : 0;
    return v ? { files: v.groups.flatMap((g) => g.files.map((f) => ({ path: f.file.path, add: f.diff.add, del: f.diff.del }))), add: v.additions, del: v.deletions, uncommitted, reload } : null;
  }, [res.data, reload]);
}


/** What a turn reads from its thread screen besides the turn itself. */
export type TurnCtx = {
  thread: Thread;
  view: ThreadOf<Artifact, Thread>;
  history: ReturnType<typeof useThread>['history'];
  conductor: boolean;
  /** The Conductor's channel, for its saved icon and background on the turns it answered. */
  conductorChannel: Channel | undefined;
  crew: Thread[];
  team?: Thread[];
  ch: Channel | undefined;
  changes: ReturnType<typeof useBranchChanges>;
  pr: ReturnType<typeof useThreadPR>[0];
  now: number;
  shell: ReturnType<typeof useShell>;
  /** This machine's agents, for each reply's author line, and the lock line under a remote agent's (`server` set). */
  agents: readonly (AgentLook & { server?: unknown })[];
  /** The running turn's latest status (`statusLabel`), null for the default. */
  status: string | null;
  /** What the running turn is doing (`turnPhase`), for the thinking line's dot. */
  turn: TurnPhase | null;
  /** The thread's status mark, as the header's pill draws it: the head of the reply being written shows it (ADR 0021). */
  mark: Mark;
};

function TurnBody({ t, last, c }: { t: TurnView; last: boolean; c: TurnCtx }) {
  const { conductor, ch, thread, changes, pr, now, shell } = c;
  const steps = (t: TurnView) => shell.open(href.threadView(thread.id, 'steps', t.key));
  const viewer = (a: Artifact) => shell.open(href.thread(thread.id, a.id));
    // Ben's Asks go above the card that shows the threads they started (packages/shared/ask.ts).
    const asked = t.asks.map((a) => (
      <MoBubble key={`ask${a.thread_id}`} caption={askCaption(a)}>
        {a.question}
      </MoBubble>
    ));
    const delegated = (asked.length > 0 || t.children.length > 0) && (
      <>
        {asked}
        {delegationGroups(t, c.team).map(({ key, kids, label, asked }) => (
          <Delegation key={key} kids={kids} label={label} asked={asked} answers={t.answers} />
        ))}
      </>
    );
    if (turnLive(t)) {
      const lead = !t.author || t.author === thread.role;
      return (
        <>
          {t.status === 'queued' ? (
            <NowLine now={{ verb: 'Waiting for a free slot', target: '' }} />
          ) : (
            <ThinkingLine label={thinkingLabel(t, thread.role, c.status, c.turn)} phase={(lead && c.turn) || 'working'} since={t.at || thread.created_at} className="rounded-2xl bg-surface px-3.5 py-3 text-[14px]" />
          )}
          <MoConnectors t={t} onOpen={() => steps(t)} />
          {showsSteps(t.progress) && <MoSteps v={t.progress} failed={t.failed} onActions={() => steps(t)} />}
          {t.cloud && <CloudAgentCard p={t.cloud} />}
          {delegated}
        </>
      );
    }
    // A finished Conductor answer introduces what it delegated: its author line says who wrote it, with no outcome line.
    const quiet = conductor && t.status === 'done';
    return (
      <>
        {!quiet && (t.result || t.error || t.status !== 'done') && <Outcome t={t} harness={t.author ? null : t.harness} limit={last ? limitLabel(thread, now) : null} />}
        {t.error && <Clamped text={t.error} />}
        {t.cloud && <CloudAgentCard p={t.cloud} />}
        {/* Pages html_render showed go above the reply, as on desktop. */}
        {t.artifacts.filter((a) => isRenderPath(a.path)).map((a) => (
          <HtmlRender key={a.id} a={a} title={a.name} onOpen={() => viewer(a)} />
        ))}
        <MoConnectors t={t} onOpen={() => steps(t)} />
        {t.prose && <MoProse text={t.prose} event={t.proseKey} />}
        {t.prose && t.proseClipped && <ClippedNote event={t.proseClipped.key} clipped={t.proseClipped.clipped} />}
        {/* A remote agent could not read the thread's files: its reply ends with the lock line (ADR 0020), unless the
            channel lets remote agents see its work. */}
        {lockedReply(t, c.agents, ch) && <RemoteLockLine channelId={thread.channel_id} />}
        {delegated}
        {t.artifacts.filter((a) => !isRenderPath(a.path)).map((a) => (
          <ArtifactCard key={a.id} a={a} sub={`#${ch?.name ?? thread.channel_id} · ${shortTime(a.updated_at, now)}`} onOpen={() => viewer(a)} />
        ))}
        {last && changes && changes.files.length > 0 && <ChangesCard files={changes.files} onOpen={() => shell.open(href.threadView(thread.id, pr?.pr ? 'pr' : 'changes'))} />}
        {showsSteps(t.progress) && <MoSteps v={t.progress} failed={t.failed} onActions={() => steps(t)} />}
      </>
    );
}

function conductorFace(c: TurnCtx, look: AgentLook) {
  if (c.thread.channel_id === CONDUCTOR_CHANNEL) return undefined;
  const ch = conductorChannelLook(look, c.conductorChannel);
  return ch ? <Avatar name={ch.name} omni channelIcon={ch.icon} avatarBg={ch.avatar_bg} size={24} /> : undefined;
}

/**
 * What the turn's agent wrote, under its author line (ADR 0019): its avatar in the gutter, its name and the time, and
 * the reply indented beside the avatar. Turns are parted by Ben's messages, so each one opens a run of its own. A turn
 * no agent wrote (a thread with no agent) shows as it always did.
 */
function Reply({ t, c, shows, children }: { t: TurnView; c: TurnCtx; shows: FaceShows | undefined; children: ReactNode }) {
  const look = t.author ? agentLook(t.author, c.agents) : null;
  if (!look) return <>{children}</>;
  const first = t.items.find(isReply);
  return (
    <div className="flex flex-col gap-2">
      <AuthorLine agent={look} at={first ? replyAt(first) : null} run={seatRun(c.thread.members, look.id) ?? { harness: t.harness, model: t.result?.model }} face={look.id === 'conductor' ? conductorFace(c, look) : undefined} shows={shows} phone />
      <div className={`flex min-w-0 flex-col gap-4 ${REPLY_INDENT} empty:hidden`}>
        {children}
      </div>
    </div>
  );
}

/**
 * A message several agents answered (ADR 0019): one lane per tab, the collision flags above the tabs (Q55). Each tab
 * names its agent, whose eyes show its lane's state (a photo's or icon's ring) while the lanes run, and a flag when it
 * edited a collided file; the lane under it is that agent's reply, steps and changed files.
 */
function MoLanes({ t, c }: { t: TurnView; c: TurnCtx }) {
  const lanes = t.lanes!;
  const [picked, setPicked] = useState(lanes.turns[0]?.author ?? '');
  const panel = useId();
  const plan = lanePlan(lanes, picked);
  if (!plan) return null;
  // While any lane works, each tab's face shows its own lane's state; once they all ended they are history (D11).
  const { lane, live, open, files, working } = plan;
  return (
    <div className="flex flex-col gap-3" data-lanes={t.key}>
      {lanes.flags.map((f) => (
        <CollisionFlag key={f.key} c={f} threadId={c.thread.id} compact />
      ))}
      <Segmented
        kind="tabs"
        label="Agents answering"
        panel={panel}
        value={lane.author ?? ''}
        onChange={setPicked}
        options={plan.tabs.map((tab) => {
          const look = agentLook(tab.agent, c.agents);
          return {
            id: tab.agent,
            label: (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <AgentAvatar agent={look} size={18} shows={live ? laneShows(tab.status) : undefined} placement={live ? 'focus' : 'still'} />
                <span className="truncate">{look.name}</span>
                {tab.hit && <Icon name="alert" size={13} className="shrink-0 text-warn" />}
              </span>
            ),
            title: `${look.name}: ${tab.status}`,
          };
        })}
      />
      <div {...tabPanelProps(panel, lane.author ?? '')} className="flex flex-col gap-3">
        <Reply t={lane} c={c} shows={live ? laneShows(lane.status) : undefined}>
          {lane.questions.map((q) => (
            <QuestionCard key={q.id} threadId={c.thread.id} q={q} touch />
          ))}
          {/* Its own latest line while it works, not the thread's. */}
          <TurnBody t={lane} last={working} c={{ ...c, status: plan.latest, turn: 'working' }} />
          {files.length > 0 && (
            <ul className="flex flex-col gap-0.5 rounded-2xl bg-surface px-2 py-1.5" aria-label="Files it changed">
              {files.map((f) => (
                <li key={f.path} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-[13px] ${f.flagged ? 'lane-file-hit' : ''}`}>
                  {f.flagged ? <CollisionMark path={f.path} collisions={open} /> : <Icon name="file" size={13} className="shrink-0 text-fg-3" />}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={f.path}>
                    {f.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Reply>
      </div>
    </div>
  );
}

/** One turn: the prompts that started it, what came back, and how it ended. */
export function Turn({ t, first, last, c }: { t: TurnView; first: boolean; last: boolean; c: TurnCtx }) {
  const { thread } = c;
  return (
    <>
    {t.prompts.map((p, k) => {
      const brief = isBrief(thread, { first, index: k, atStart: atStart(c.history.history) });
      const { lead, to, chips } = promptRecipients(p, thread.role, (a) => c.agents.find((x) => x.id === a)?.name ?? a);
      const words = promptCaption(p, { index: k, brief, lead: lead?.from ?? null, taskId: thread.task_id }).text;
      return (
      <Fragment key={k}>
        <MoBubble
          event={p.key}
          fold={brief}
          caption={
            to.length ? (
              <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                {words && <span>{words}</span>}
                <SentTo agents={to} />
              </span>
            ) : (
              words
            )
          }
          above={
            <>
              {p.attachments?.length ? <Attachments threadId={thread.id} items={p.attachments} lazy={!last} /> : null}
              <ContextChips records={chips} align="end" className="w-full max-w-[86%]" />
            </>
          }
        >
          {p.text || !hasContext(p.context) ? <UserText text={p.text ?? ''} slash={p.slash} records={p.context} /> : null}
          {p.items?.length ? <PRWakeList items={p.items} more={p.more} /> : null}
        </MoBubble>
        <ClippedNote event={p.key} clipped={p.clipped} className="-mt-2.5 justify-end" />
      </Fragment>
      );
    })}
    {t.reports.map((r, k) => (
      <Report key={k} r={r} remote={r.remote ? (r.harness_name ?? r.harness ?? '') : undefined} />
    ))}
    {t.lanes ? (
      <MoLanes t={t} c={c} />
    ) : (
      // The reply being written shows live eyes; a past one's head stays idle (ADR 0021, D11).
      <Reply t={t} c={c} shows={replyShows(t, thread.members, c.mark)}>
        {t.questions.map((q) => (
          <QuestionCard key={q.id} threadId={thread.id} q={q} touch />
        ))}
        <TurnBody t={t} last={last} c={c} />
      </Reply>
    )}
    {t.flags?.map((f) => (
      <CollisionFlag key={f.key} c={f} threadId={thread.id} compact />
    ))}
    {t.switches.map((it) => (
      <SwitchLine key={it.key} it={it} running={thread.status === 'running'} />
    ))}
    {t.members.map((it) => (
      <MemberLine key={it.key} p={it.p} />
    ))}
    {t.risks?.map((it) => (
      <MergeRiskCard key={it.key} p={it.p} />
    ))}
    </>
  );
}
