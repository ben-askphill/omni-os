import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useApi, type Artifact, type BranchChanges, type Channel, type Thread } from '../api.ts';
import { Attachments, SwitchLine } from '../components/Transcript.tsx';
import { PRWakeList } from '../components/thread/PRWatch.tsx';
import { QuestionCard } from '../components/thread/QuestionCard.tsx';
import { CloudAgentCard } from '../components/thread/CloudAgentCard.tsx';
import { ClippedNote } from '../components/thread/HistoryEdgeRow.tsx';
import type { useThreadPR } from '../components/thread/ThreadPR.tsx';
import { OmniMark } from '../components/brand.tsx';
import { ContextChips, hasContext } from '../message-context/ContextChips.tsx';
import { changesView } from '../changes.ts';
import { atStart } from '@omni/shared/history.ts';
import { href } from '../router.ts';
import { ArtifactCard, ChangesCard, Clamped, Delegation, MoProse, NowLine, Outcome, Plan, Report, StepsRow } from './ThreadCards.tsx';
import { MoBubble } from './parts.tsx';
import { shortTime } from './rows.ts';
import type { useShell, useThread } from './shell.tsx';
import type { ThreadView } from './thread-view.ts';
import type { TurnView } from './thread-view.ts';

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
  view: ThreadView;
  history: ReturnType<typeof useThread>['history'];
  conductor: boolean;
  crew: Thread[];
  ch: Channel | undefined;
  changes: ReturnType<typeof useBranchChanges>;
  pr: ReturnType<typeof useThreadPR>;
  now: number;
  shell: ReturnType<typeof useShell>;
};

function TurnBody({ t, last, c }: { t: TurnView; last: boolean; c: TurnCtx }) {
  const { view, conductor, crew, ch, thread, changes, pr, now, shell } = c;
  const steps = (t: TurnView) => shell.open(href.threadView(thread.id, 'steps', t.key));
  const viewer = (a: Artifact) => shell.open(href.thread(thread.id, a.id));
  const sinceStart = (t: TurnView) => shortTime(t.at || thread.created_at, now);
    const delegated = t.children.length > 0 && <Delegation kids={t.children} />;
    if (last && (t.status === 'running' || t.status === 'queued')) {
      return (
        <>
          {t.status === 'queued' ? (
            <NowLine now={{ verb: 'Waiting for a free slot', target: '' }} />
          ) : (
            view.now && <NowLine now={view.now} meta={view.plan ? `step ${Math.min(view.plan.done + 1, view.plan.todos.length)}/${view.plan.todos.length}` : sinceStart(t)} />
          )}
          {view.plan && <Plan plan={view.plan} />}
          {t.cloud && <CloudAgentCard p={t.cloud} />}
          {delegated}
          {t.steps > 0 && <StepsRow t={t} live onClick={() => steps(t)} />}
        </>
      );
    }
    // The Conductor's answer introduces what it delegated, so it reads before the card, under its own name.
    const quiet = conductor && t.status === 'done';
    return (
      <>
        {quiet && (t.prose || delegated) ? (
          <div className="flex items-center gap-2 text-[12.5px] leading-none text-fg-3">
            <OmniMark size={20} state={crew.some((c) => c.status === 'running') ? 'delegating' : 'idle'} />
            Conductor
          </div>
        ) : (
          (t.result || t.error || t.status !== 'done') && <Outcome t={t} harness={t.harness} />
        )}
        {t.error && <Clamped text={t.error} />}
        {t.cloud && <CloudAgentCard p={t.cloud} />}
        {t.prose && <MoProse text={t.prose} />}
        {t.prose && t.proseClipped && <ClippedNote event={t.proseClipped.key} clipped={t.proseClipped.clipped} />}
        {delegated}
        {t.artifacts.map((a) => (
          <ArtifactCard key={a.id} a={a} sub={`#${ch?.name ?? thread.channel_id} · ${shortTime(a.updated_at, now)}`} onOpen={() => viewer(a)} />
        ))}
        {last && changes && changes.files.length > 0 && <ChangesCard files={changes.files} onOpen={() => shell.open(href.threadView(thread.id, pr?.pr ? 'pr' : 'changes'))} />}
        {t.steps > 0 && <StepsRow t={t} onClick={() => steps(t)} />}
      </>
    );
}

/** One turn: the prompts that started it, what came back, and how it ended. */
export function Turn({ t, first, last, c }: { t: TurnView; first: boolean; last: boolean; c: TurnCtx }) {
  const { thread } = c;
  return (
    <>
    {t.prompts.map((p, k) => (
      <Fragment key={k}>
        <MoBubble
          caption={
            p.dropped
              ? p.undelivered
                ? `Not delivered · ${p.undelivered}`
                : 'Not sent'
              : p.source === 'pr-watch'
                ? 'PR watch'
              : first && k === 0 && thread.parent_id && atStart(c.history.history)
                ? `Delegated by the Conductor${thread.task_id ? ` · ${thread.task_id}` : ''}`
                : k > 0
                  ? 'Sent while it ran'
                  : undefined
          }
          above={
            <>
              {p.attachments?.length ? <Attachments threadId={thread.id} items={p.attachments} /> : null}
              <ContextChips records={p.context} align="end" className="w-full max-w-[86%]" />
            </>
          }
        >
          {p.text || !hasContext(p.context) ? p.text : null}
          {p.items?.length ? <PRWakeList items={p.items} more={p.more} /> : null}
        </MoBubble>
        <ClippedNote event={p.key} clipped={p.clipped} className="-mt-2.5 justify-end" />
      </Fragment>
    ))}
    {t.reports.map((r, k) => (
      <Report key={k} role={r.role} taskId={r.task_id} text={r.text} dropped={r.dropped} undelivered={r.undelivered} />
    ))}
    {t.questions.map((q) => (
      <QuestionCard key={q.id} threadId={thread.id} q={q} touch />
    ))}
    <TurnBody t={t} last={last} c={c} />
    {t.switches.map((it) => (
      <SwitchLine key={it.key} it={it} running={thread.status === 'running'} />
    ))}
    </>
  );
}
