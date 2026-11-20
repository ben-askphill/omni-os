import { PHASE, type TurnPhase } from '@omni/shared/status.ts';
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useApi, type Artifact, type BranchChanges, type Channel, type Thread } from '../api.ts';
import { Attachments, MemberLine, SwitchLine } from '../components/Transcript.tsx';
import { PRWakeList } from '../components/thread/PRWatch.tsx';
import { QuestionCard } from '../components/thread/QuestionCard.tsx';
import { CloudAgentCard } from '../components/thread/CloudAgentCard.tsx';
import { ClippedNote } from '../components/thread/HistoryEdgeRow.tsx';
import type { useThreadPR } from '../components/thread/ThreadPR.tsx';
import { OmniMark } from '../components/brand.tsx';
import { agentLook, type AgentLook } from '../components/AgentAvatar.tsx';
import { AuthorLine, REPLY_INDENT } from '../components/AuthorLine.tsx';
import { Avatar } from '../components/ui.tsx';
import { hasOwnLook } from '@omni/shared/channel-icon.ts';
import { ThinkingLine } from '../components/thread/ThinkingLine.tsx';
import { ContextChips, hasContext } from '../message-context/ContextChips.tsx';
import { MentionText } from '../message-context/MentionText.tsx';
import { chipRecords } from '@omni/shared/message-context-machine.ts';
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
    return v ? { files: v.groups.flatMap((g) => g.files.map((f) => ({ path: f.file.path, add: f.diff.add, del: f.diff.del }))), add: v.additions, del: v.deletions } : null;
  }, [res.data]);
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
  ch: Channel | undefined;
  changes: ReturnType<typeof useBranchChanges>;
  pr: ReturnType<typeof useThreadPR>[0];
  now: number;
  shell: ReturnType<typeof useShell>;
  /** This machine's agents, for each reply's author line. */
  agents: readonly AgentLook[];
  /** The running turn's latest status (`statusLabel`), null for the default. */
  status: string | null;
  /** What the running turn is doing (`turnPhase`), for the thinking line's dot. */
  turn: TurnPhase | null;
};

/** Who a turn's Asks went to, when each thread it started came from one: one role by name, several by count. */
function askedOf(t: TurnView): { name: string; remote: string | null } | undefined {
  const asks = new Map(t.asks.map((a) => [a.thread_id, a]));
  if (!t.children.length || !t.children.every((k) => asks.has(k.id))) return undefined;
  const sent = t.children.map((k) => asks.get(k.id)!);
  const names = new Set(sent.map((a) => a.name));
  if (names.size > 1) return { name: `${names.size} roles`, remote: null };
  return { name: sent[0].name, remote: sent[0].remote ? sent[0].harness_name : null };
}

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
        {t.children.length > 0 && <Delegation kids={t.children} answers={t.answers} asked={askedOf(t)} />}
      </>
    );
    if (last && (t.status === 'running' || t.status === 'queued')) {
      return (
        <>
          {t.status === 'queued' ? (
            <NowLine now={{ verb: 'Waiting for a free slot', target: '' }} />
          ) : (
            <ThinkingLine label={c.status ?? (c.turn === 'starting' ? PHASE.starting.label : 'Thinking')} phase={c.turn ?? 'working'} since={t.at || thread.created_at} className="rounded-2xl bg-surface px-3.5 py-3 text-[14px]" />
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
        {delegated}
        {t.artifacts.filter((a) => !isRenderPath(a.path)).map((a) => (
          <ArtifactCard key={a.id} a={a} sub={`#${ch?.name ?? thread.channel_id} · ${shortTime(a.updated_at, now)}`} onOpen={() => viewer(a)} />
        ))}
        {last && changes && changes.files.length > 0 && <ChangesCard files={changes.files} onOpen={() => shell.open(href.threadView(thread.id, pr?.pr ? 'pr' : 'changes'))} />}
        {showsSteps(t.progress) && <MoSteps v={t.progress} failed={t.failed} onActions={() => steps(t)} />}
      </>
    );
}

/**
 * The Conductor's face on its answers: the icon and background saved for its channel, else the Omni mark, unless Ben
 * gave the Conductor agent an image or icon of its own.
 */
function conductorFace(c: TurnCtx, look: AgentLook) {
  if (look.avatar?.image || look.avatar?.icon) return undefined;
  const ch = c.conductorChannel;
  return ch && hasOwnLook(ch) ? <Avatar name={ch.name} omni channelIcon={ch.icon} avatarBg={ch.avatar_bg} size={24} /> : <OmniMark size={24} />;
}

/**
 * What the turn's agent wrote, under its author line (ADR 0019): its avatar in the gutter, its name and the time, and
 * the reply indented beside the avatar. Turns are parted by Ben's messages, so each one opens a run of its own. A turn
 * no agent wrote (a thread with no agent) shows as it always did.
 */
function Reply({ t, c, children }: { t: TurnView; c: TurnCtx; children: ReactNode }) {
  const look = t.author ? agentLook(t.author, c.agents) : null;
  if (!look) return <>{children}</>;
  const first = t.items.find(isReply);
  return (
    <div className="flex flex-col gap-2">
      <AuthorLine agent={look} at={first ? replyAt(first) : null} run={{ harness: t.harness, model: t.result?.model }} face={look.id === 'conductor' ? conductorFace(c, look) : undefined} phone />
      <div className={`flex min-w-0 flex-col gap-4 ${REPLY_INDENT} empty:hidden`}>{children}</div>
    </div>
  );
}

/** One turn: the prompts that started it, what came back, and how it ended. */
export function Turn({ t, first, last, c }: { t: TurnView; first: boolean; last: boolean; c: TurnCtx }) {
  const { thread } = c;
  return (
    <>
    {t.prompts.map((p, k) => {
      const brief = first && k === 0 && !!thread.parent_id && atStart(c.history.history);
      return (
      <Fragment key={k}>
        <MoBubble
          event={p.key}
          fold={brief}
          caption={
            p.dropped
              ? p.undelivered
                ? `Not delivered · ${p.undelivered}`
                : 'Not sent'
              : p.source === 'pr-watch'
                ? 'PR watch'
              : brief
                ? `Delegated by the Conductor${thread.task_id ? ` · ${thread.task_id}` : ''}`
                : k > 0
                  ? 'Sent while it ran'
                  : undefined
          }
          above={
            <>
              {p.attachments?.length ? <Attachments threadId={thread.id} items={p.attachments} lazy={!last} /> : null}
              <ContextChips records={chipRecords(p.text ?? '', p.context)} align="end" className="w-full max-w-[86%]" />
            </>
          }
        >
          {p.text || !hasContext(p.context) ? <MentionText text={p.text ?? ''} records={p.context} /> : null}
          {p.items?.length ? <PRWakeList items={p.items} more={p.more} /> : null}
        </MoBubble>
        <ClippedNote event={p.key} clipped={p.clipped} className="-mt-2.5 justify-end" />
      </Fragment>
      );
    })}
    {t.reports.map((r, k) => (
      <Report key={k} role={r.role} taskId={r.task_id} text={r.text} dropped={r.dropped} undelivered={r.undelivered} remote={r.remote ? (r.harness_name ?? r.harness ?? '') : undefined} />
    ))}
    <Reply t={t} c={c}>
      {t.questions.map((q) => (
        <QuestionCard key={q.id} threadId={thread.id} q={q} touch />
      ))}
      <TurnBody t={t} last={last} c={c} />
    </Reply>
    {t.switches.map((it) => (
      <SwitchLine key={it.key} it={it} running={thread.status === 'running'} />
    ))}
    {t.members.map((it) => (
      <MemberLine key={it.key} p={it.p} />
    ))}
    </>
  );
}
