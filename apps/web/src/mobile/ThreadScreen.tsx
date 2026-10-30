import { Fragment, useMemo, useState } from 'react';
import { api, errorText, type Artifact, type Thread } from '../api.ts';
import { harnessLabel } from '../components/brand.tsx';
import { ASKING_LABEL } from '../components/thread/QuestionCard.tsx';
import { OPEN_PR_PROMPT, useThreadPR } from '../components/thread/ThreadPR.tsx';
import { SetupCard } from '../components/thread/SetupCard.tsx';
import { StaleSessionCard } from '../components/thread/StaleSessionCard.tsx';
import { HistoryCtx, HistoryEdgeRow } from '../components/thread/HistoryEdgeRow.tsx';
import { historyEdges } from '@omni/shared/history.ts';
import { HandoffCard, type HandoffAnswer } from '../components/thread/Handoff.tsx';
import { TakeoverNote } from '../components/thread/Takeover.tsx';
import { MoContinueLinks } from '../components/ContinueLinks.tsx';
import { ErrorNote, StatusPill } from '../components/ui.tsx';
import { plural } from '../format.ts';
import { reasonOf } from '../needs-you.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { needsCard } from './activity.ts';
import { MoComposer, type ComposerChip } from './MoComposer.tsx';
import { NeedsCardView } from './NeedsCard.tsx';
import { MoEmpty, MoHeader, MoRound } from './parts.tsx';
import { useShell, useThread } from './shell.tsx';
import { Pending, Sending } from './ThreadCards.tsx';
import { MenuSheet } from './ThreadMenuSheet.tsx';
import { Turn, useBranchChanges, type TurnCtx } from './ThreadTurn.tsx';
import { useOpenOnNewestTurn } from './useOpenOnNewestTurn.ts';
import { threadView } from './thread-view.ts';

/** The thread: the outcome first, steps folded behind a row, one secondary surface at a time from the menu. */
export function ThreadScreen() {
  const shell = useShell();
  const s = useThread();
  const { thread, parent, children, events, history, revealTarget, clearReveal, files, queued, setQueued, applyThread, slotBusy, interrupt, interrupting, notFound, error, actionError, load, ready, handoff, setHandoff, takeover } = s;
  const { needsYou, channel } = useApp();
  const now = useNow(30_000);
  const [menu, setMenu] = useState(false);
  const spans = history.history.spans;
  const view = useMemo(() => (thread ? threadView({ events, spans, thread, artifacts: files, children }) : null), [events, spans, thread, files, children]);
  const edges = useMemo(() => historyEdges({ spans }, view?.turns.map((t) => t.key) ?? []), [spans, view]);
  const changes = useBranchChanges(thread, slotBusy);
  const pr = useThreadPR(thread, slotBusy, true);
  const { scroll, newest } = useOpenOnNewestTurn({ view, history, ready, revealTarget, clearReveal });

  if (notFound || (!thread && error)) {
    return (
      <>
        <MoHeader onBack={shell.back} title="Thread" />
        {notFound ? <MoEmpty>This thread was deleted, or the link is wrong.</MoEmpty> : <ErrorNote className="mx-4" onRetry={() => void load()}>{error}</ErrorNote>}
      </>
    );
  }
  if (!thread || !view) {
    return (
      <>
        <MoHeader onBack={shell.back} title="Thread" />
        <MoEmpty>Loading</MoEmpty>
      </>
    );
  }

  const ch = channel(thread.channel_id);
  const conductor = thread.channel_id === 'conductor' || thread.role === 'conductor';
  const crew = children.filter((c) => c.source !== 'team');
  const item = needsYou?.items.find((i) => i.thread.id === thread.id);
  const card = item && item.blockers.length ? needsCard(item, ch, harnessLabel, now) : null;
  const latest = view.turns[view.turns.length - 1];
  const viewer = (a: Artifact) => shell.open(href.thread(thread.id, a.id));
  const theirs = conductor ? 'the Conductor' : thread.role ? `the ${thread.role}` : 'the agent';
  const handedOff = (a: HandoffAnswer) => {
    applyThread(a.thread, true);
    setHandoff(a.handoff);
  };

  const openPR = async () => {
    try {
      applyThread(await api.post<Thread>(`/threads/${encodeURIComponent(thread.id)}/messages`, { prompt: OPEN_PR_PROMPT }), true);
      shell.toast(`Asked ${theirs} to open a PR`);
    } catch (e) {
      shell.toast(errorText(e));
    }
  };
  const report = latest?.artifacts.find((a) => a.kind === 'html' || a.kind === 'markdown' || a.kind === 'pdf') ?? latest?.artifacts[0];
  const chips: ComposerChip[] = [];
  if (report) chips.push({ label: 'Open report', icon: 'file', onClick: () => viewer(report) });
  if (pr?.pr) chips.push({ label: `Review #${pr.pr.number}`, icon: 'pr', diff: [pr.pr.additions, pr.pr.deletions], onClick: () => shell.open(href.threadView(thread.id, 'pr')) });
  else if (changes?.files.length) {
    chips.push({ label: slotBusy ? 'Changes so far' : 'Review changes', icon: 'diff', diff: [changes.add, changes.del], onClick: () => shell.open(href.threadView(thread.id, 'changes')) });
    if (!slotBusy) chips.push({ label: 'Open PR', icon: 'pr', onClick: () => void openPR() });
  }
  if (!slotBusy && !conductor) chips.push({ label: 'Ask the Conductor', icon: 'delegate', onClick: () => shell.sheet({ name: 'new' }) });
  if (!conductor) chips.push({ label: 'New thread', icon: 'plus', onClick: () => shell.sheet({ name: 'new', channel: thread.channel_id }) });

  const sub = conductor ? `Conductor · ${plural(crew.length, 'crew thread')}` : [`#${ch?.name ?? thread.channel_id}`, thread.role, harnessLabel(thread.harness)].filter(Boolean).join(' · ');
  // A Conductor thread needs Ben while any thread it delegated does.
  const kidIds = new Set(crew.map((c) => c.id));
  const needs = card?.glyph === 'needs' || (conductor && !!needsYou?.items.some((i) => kidIds.has(i.thread.id) && reasonOf(i).glyph === 'needs'));
  const ctx: TurnCtx = { thread, view, history, conductor, crew, ch, changes, pr, now, shell };

  return (
    <>
      <MoHeader
        onBack={shell.back}
        title={thread.title || 'Untitled'}
        sub={parent ? <span>{sub} · <a href={href.thread(parent.id)} className="text-fg-2 hover:text-fg" title={`Delegated from ${parent.title}`}>Parent: {parent.title}</a></span> : sub}
        right={
          <>
            <StatusPill status={view.asking || needs ? 'needs' : thread.status} label={view.asking ? ASKING_LABEL : needs ? 'Needs you' : undefined} />
            <MoRound icon="more" label="Thread options" onClick={() => setMenu(true)} />
          </>
        }
      />
      <div ref={scroll} className="mo-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4 [overflow-anchor:none]">
        <HistoryCtx.Provider value={history}>
          <div className="flex flex-col gap-4">
            <MoContinueLinks links={s.links} onOpen={(id) => shell.open(href.thread(id))} />
            {view.turns.map((t, i) => {
              const last = i === view.turns.length - 1;
              const edge = edges.get(t.key);
              return (
                <Fragment key={t.key}>
                  {edge && <HistoryEdgeRow edge={edge} history={history} touch />}
                  <div data-key={t.key} ref={last ? newest : undefined} className="flex flex-col gap-4">
                    <Turn t={t} first={i === 0} last={last} c={ctx} />
                  </div>
                </Fragment>
              );
            })}
            {edges.get(-1) && <HistoryEdgeRow edge={edges.get(-1)!} history={history} touch />}
            <HandoffCard thread={thread} handoff={handoff} mobile onChanged={handedOff} />
            {!view.turns.length && !thread.setup && <MoEmpty>Nothing here yet.</MoEmpty>}
            <SetupCard
              thread={thread}
              mobile
              onRetried={(t, pending) => {
                // Retry keeps updated_at, so it must win a tie.
                applyThread(t);
                setQueued(pending);
              }}
            />
            <StaleSessionCard
              thread={thread}
              mobile
              onChanged={(t, pending) => {
                // Keeps updated_at, so it must win a tie.
                applyThread(t);
                setQueued(pending);
              }}
            />
            {/* A question's card above is where Ben answers it, and the setup card is where he retries setup. */}
            {card && card.kind !== 'question' && card.kind !== 'setup' && <NeedsCardView card={card} inThread onRecovered={(r) => {
                  applyThread(r.thread, true);
                  setQueued(r.pending);
                }} />}
            {queued.length > 0 && <Pending thread={thread} items={queued} onPending={setQueued} />}
            <Sending threadId={thread.id} pending={queued} />
            {actionError && <ErrorNote>{actionError}</ErrorNote>}
          </div>
        </HistoryCtx.Provider>
      </div>
      <TakeoverNote threadId={thread.id} takeover={takeover} handoff={handoff} mobile onChanged={handedOff} />
      <MoComposer
        thread={thread}
        chips={chips}
        // Nothing runs while the worktree is prepared, so there is nothing to stop.
        stop={slotBusy && !thread.setup ? { busy: interrupting, run: () => void interrupt() } : null}
        placeholder={(steers) => (conductor ? 'Reply to the Conductor' : !slotBusy ? 'Follow up' : steers ? `Steer ${theirs}` : 'Queue for after this turn')}
        onSent={(t) => applyThread(t, true)}
        onSwitched={(t) => applyThread(t)}
        onFork={() => shell.sheet({ name: 'continue', source: thread })}
      />
      {menu && <MenuSheet thread={thread} prLabel={pr?.pr ? `PR #${pr.pr.number} · ${plural(changes?.files.length ?? 0, 'file')}` : null} onClose={() => setMenu(false)} />}
    </>
  );
}

