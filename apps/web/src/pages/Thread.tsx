import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, type HarnessWithRunning } from '../api.ts';
import { ReplyComposer } from '../components/Composer.tsx';
import { QueuedMessages, SendingMessages, Transcript } from '../components/Transcript.tsx';
import { LinkChannel } from '../link-previews.ts';
import { ThreadIdCtx } from '../components/thread/ToolOutput.tsx';
import { PanelResizeHandle } from '../components/thread/panel/PanelResizeHandle.tsx';
import { NextThreadCard } from '../components/thread/NextThreadCard.tsx';
import { SetupCard } from '../components/thread/SetupCard.tsx';
import { LimitCard } from '../components/thread/LimitCard.tsx';
import { StaleSessionCard } from '../components/thread/StaleSessionCard.tsx';
import { HandoffCard, type HandoffAnswer } from '../components/thread/Handoff.tsx';
import { useThreadPR } from '../components/thread/ThreadPR.tsx';
import { usePRWatch } from '../components/thread/PRWatch.tsx';
import { useBranchChanges } from '../mobile/ThreadTurn.tsx';
import { prNext } from '@omni/shared/thread-glance.ts';
import { ContextMeter } from '../components/thread/ContextMeter.tsx';
import { ThreadHeader } from '../components/thread/ThreadHeader.tsx';
import { ThreadPanel } from '../components/thread/ThreadPanel.tsx';
import { AGENTS_CARD_ID } from '../components/thread/panel/AgentsSection.tsx';
import { Empty, ErrorNote, Icon, LinkButton, Loading } from '../components/ui.tsx';
import { href, navigate, type ThreadView } from '../router.ts';
import { reportNotes } from '../requests.ts';
import { canSteer } from '../steer.ts';
import { teamOf } from '../transcript/delegation.ts';
import { runningSubagents } from '../subagents.ts';
import { isAsking } from '@omni/shared/transcript-fold.ts';
import { useApp } from '../store.tsx';
import { useThreadActions } from './useThreadActions.ts';
import { useThreadInterruptKey } from './useThreadInterruptKey.ts';
import { useThreadPanel } from './useThreadPanel.ts';
import { useThreadPresence } from './useThreadPresence.ts';
import { useThreadSession } from './useThreadSession.ts';
import { useTranscriptScroll } from './useTranscriptScroll.ts';
import { useReveal } from './useReveal.ts';
import { tailId } from '@omni/shared/history.ts';
import { blockedNote } from '@omni/shared/thread-machine.ts';

export function ThreadPage({ id, artifact: artifactParam, at, view }: { id: string; artifact?: number; at?: number; view?: ThreadView }) {
  const { mods, tasks } = useApp();
  const modLines = useMemo(() => mods.filter((m) => m.thread_id === id), [mods, id]);
  // GET /api/harnesses, the same list the reply pills load. Until it arrives, canSteer uses the Cursor fallback.
  const { data: harnesses } = useApi<HarnessWithRunning[]>('/harnesses');
  const {
    thread,
    channel,
    parent,
    children,
    team,
    events,
    history,
    revealTarget,
    clearReveal,
    jumpTo,
    files,
    shots,
    selectedArtifact,
    setSelected,
    panelTab,
    setPanelTab,
    error,
    actionError,
    setActionError,
    notFound,
    ready,
    queued,
    setQueued,
    warm,
    blocked,
    handoff,
    setHandoff,
    takeover,
    links,
    live,
    load,
    applyThread,
    slotBusy,
    turnInProgress,
    interrupting,
    interrupt,
    init,
    lastResult,
    betweenTurns,
    context,
  } = useThreadSession(id, artifactParam, at);
  const { scrollRef, contentRef, onScroll, showJump, jump, pin, release, following } = useTranscriptScroll(tailId(history.history), events, thread !== null);
  const { follows } = history;
  useEffect(() => {
    follows.current = following;
  }, [follows, following]);
  useReveal(scrollRef, revealTarget, events, () => {
    release();
    clearReveal();
  });
  const handedOff = (a: HandoffAnswer) => {
    applyThread(a.thread, true);
    setHandoff(a.handoff);
  };
  const note = blockedNote(blocked, handoff, thread?.status, takeover);
  const known = useMemo(() => [...children, ...team], [children, team]);
  const members = useMemo(() => teamOf(children), [children]);
  const reports = useMemo(() => reportNotes(queued), [queued]);
  const asking = useMemo(() => isAsking(events), [events]);
  const agents = useMemo(() => runningSubagents(tasks, id), [tasks, id]);
  const selectArtifact = useCallback(
    (artifact: number) => {
      setSelected(artifact);
      setPanelTab('artifacts');
    },
    [setSelected, setPanelTab],
  );
  const panel = useThreadPanel({ artifactParam, files, ready, loaded: thread !== null, select: selectArtifact });
  // A delegate count links here as /details: the panel opens on Details at the agents card, and the address goes back
  // to the thread's own, so the next click on the count lands here again.
  const [toAgents, setToAgents] = useState(false);
  const { show: showPanel } = panel;
  useEffect(() => {
    if (view !== 'details') return;
    setPanelTab('details');
    showPanel();
    setToAgents(true);
    navigate(href.thread(id), { replace: true });
  }, [view, id, setPanelTab, showPanel]);
  useEffect(() => {
    if (!toAgents || panelTab !== 'details') return;
    const card = document.getElementById(AGENTS_CARD_ID);
    if (!card) return;
    card.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setToAgents(false);
  }, [toAgents, panelTab, children, panel.open]);
  const { prBusy, restoring, ask, restore, toggleDone } = useThreadActions({ id, thread, slotBusy, applyThread, setActionError, pin });
  // The branch's PRs and changes: the PRs tab and the Details tab's branch card read them, and the PRs tab's badge.
  const prs = useThreadPR(thread, slotBusy);
  const watch = usePRWatch(thread?.id, prs);
  const changes = useBranchChanges(thread, slotBusy);
  const next = prNext(prs?.pr ?? null, !!changes?.files.length);

  useThreadPresence(id, thread);
  useThreadInterruptKey({ slotBusy, interrupting, interrupt });

  if (notFound) {
    return (
      <div className="h-full overflow-y-auto">
        <Empty icon="message" title="Thread not found" action={<LinkButton href={href.home()}>Go home</LinkButton>}>
          It may have been deleted, or the link is wrong.
        </Empty>
      </div>
    );
  }
  if (!thread) {
    return (
      <div className="px-6">
        {error ? (
          <ErrorNote className="mt-6" onRetry={() => void load()}>
            {error}
          </ErrorNote>
        ) : (
          <Loading label="Loading thread" />
        )}
      </div>
    );
  }

  const artifactCount = files.length + shots.length;

  return (
    <div ref={panel.rootRef} className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ThreadHeader
          thread={thread}
          channel={channel}
          parent={parent}
          links={links}
          modLines={modLines}
          actions={{
            thread,
            meter: (
              <ContextMeter
                thread={thread}
                pushed={context}
                onCompacted={(t) => {
                  applyThread(t, true);
                  pin();
                }}
              />
            ),
            reconnecting: !live && ready,
            onDone: () => void toggleDone(),
            onRestore: () => void restore(),
            restoring,
            panelOpen: panel.open,
            onPanel: panel.toggle,
            artifactCount,
            asking,
          }}
        />

        {/* transcript */}
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={onScroll} className="scroll-thin h-full overflow-y-auto [overflow-anchor:none]">
            <div ref={contentRef} className="mx-auto max-w-4xl px-4 pt-4 pb-10 md:px-6">
              {/* Queued means waiting for a slot: nothing is working yet. */}
              <LinkChannel.Provider value={thread.channel_id}>
                <ThreadIdCtx.Provider value={id}>
                  <Transcript threadId={id} events={events} running={turnInProgress} cwd={init?.cwd || thread.cwd} known={known} team={members} artifacts={files} reports={reports} history={history} />
                </ThreadIdCtx.Provider>
              </LinkChannel.Provider>
              <SetupCard
                thread={thread}
                onRetried={(t, pending) => {
                  // Retry keeps updated_at, so it must win a tie, like a rename.
                  applyThread(t);
                  setQueued(pending);
                }}
              />
              <StaleSessionCard
                thread={thread}
                onChanged={(t, pending) => {
                  // Keeps updated_at, so it must win a tie, like Retry.
                  applyThread(t);
                  setQueued(pending);
                }}
              />
              <LimitCard
                thread={thread}
                onChanged={(t, pending) => {
                  // Scheduling keeps updated_at, so it must win a tie, like Retry.
                  applyThread(t);
                  setQueued(pending);
                }}
              />
              <HandoffCard thread={thread} handoff={handoff} onChanged={handedOff} />
              <QueuedMessages items={queued} starting={betweenTurns} threadId={id} onPending={setQueued} setup={thread.setup} sessionBlocked={!!thread.resume_blocked} canSteer={canSteer(thread.harness, harnesses)} />
              <SendingMessages threadId={id} pending={queued} />
              {!queued.length && (
                <NextThreadCard
                  thread={thread}
                  onThread={(t, reply) => {
                    applyThread(t, reply);
                    if (reply) pin();
                  }}
                />
              )}
            </div>
          </div>
          {showJump && (
            <button
              type="button"
              onClick={jump}
              className="float pop-in press absolute bottom-4 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium"
            >
              <Icon name="chevronDown" size={13} /> New activity
            </button>
          )}
        </div>

        {/* composer */}
        <div className="relative shrink-0 bg-bg px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:pb-4">
          <div className="mx-auto max-w-4xl">
            {actionError && <ErrorNote className="mb-2">{actionError}</ErrorNote>}
            {/* The setup card above says why while the worktree is not ready. */}
            {note && !thread.setup && <ErrorNote className="mb-2">{note}</ErrorNote>}
            <ReplyComposer
              thread={thread}
              canSteer={canSteer(thread.harness, harnesses)}
              // Nothing runs while the worktree is prepared, so there is nothing to stop.
              stop={slotBusy && !thread.setup ? { busy: interrupting, run: () => void interrupt() } : null}
              onSent={(t) => {
                applyThread(t, true);
                pin();
              }}
              // A rename keeps updated_at, so it has to win a tie.
              onChanged={(t) => applyThread(t)}
              machine={{ blocked, handoff, takeover, onChanged: handedOff }}
            />
          </div>
        </div>
      </div>

      {/* panel */}
      {panel.open && (
        <aside className="relative shrink-0 py-2 pr-2" style={{ width: panel.width }}>
          <PanelResizeHandle width={panel.width} max={panel.max} onChange={panel.resize} onReset={panel.reset} />
          <div className="panel-in h-full overflow-hidden rounded-[18px] border border-line bg-surface">
            <ThreadPanel
              thread={thread}
              files={files}
              shots={shots}
              selectedArtifact={selectedArtifact}
              onSelect={setSelected}
              tab={panelTab}
              onTab={setPanelTab}
              onClose={panel.toggle}
              details={{ channel, parent, children, init, lastResult, warm, links, agents, onJump: jumpTo, prs, changes, next, busy: prBusy, onAsk: (p) => void ask(p), onTab: setPanelTab }}
              prs={{ data: prs, watch, next, busy: prBusy, onAsk: (p) => void ask(p) }}
            />
          </div>
        </aside>
      )}
    </div>
  );
}
