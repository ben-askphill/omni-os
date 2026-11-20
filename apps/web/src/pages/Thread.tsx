import { turnPhase } from '@omni/shared/status.ts';
import { useThreadAccount } from '../accounts.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, type HarnessWithRunning } from '../api.ts';
import { ReplyComposer } from '../components/Composer.tsx';
import { QueuedMessages, SendingMessages, Transcript } from '../components/Transcript.tsx';
import { LinkChannel } from '../link-previews.ts';
import { ThreadIdCtx } from '../components/thread/ToolOutput.tsx';
import { PanelResizeHandle } from '../components/thread/panel/PanelResizeHandle.tsx';
import { NextThreadCard } from '../components/thread/NextThreadCard.tsx';
import { OpenItemsCard } from '../components/thread/OpenItemsCard.tsx';
import { sameSettings } from '../new-thread-preset.ts';
import { SetupCard } from '../components/thread/SetupCard.tsx';
import { CrewQuestions } from '../components/thread/CrewQuestions.tsx';
import { LimitCard } from '../components/thread/LimitCard.tsx';
import { GoalLine } from '../components/thread/GoalLine.tsx';
import { StaleSessionCard } from '../components/thread/StaleSessionCard.tsx';
import { HandoffCard, type HandoffAnswer } from '../components/thread/Handoff.tsx';
import { useThreadPR } from '../components/thread/ThreadPR.tsx';
import { usePRWatch } from '../components/thread/PRWatch.tsx';
import { useBranchChanges } from '../mobile/ThreadTurn.tsx';
import { prNext, prOffered, stepOf, stepParked, stepPrompts, stepUnderway } from '@omni/shared/thread-glance.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import { useShowsCode } from '../display.ts';
import { ThreadHeader } from '../components/thread/ThreadHeader.tsx';
import { ThreadPanel } from '../components/thread/ThreadPanel.tsx';
import { ThreadQuickCard, useThreadConnectors } from '../components/thread/ThreadQuickCard.tsx';
import { COMPOSER_CLEARS_CARD, QUICK_CARD_SLOT, THREAD_COLUMN } from '../components/thread/quick-card-layout.ts';
import { ProgressCard, useProgressPanel } from '../components/thread/ProgressCard.tsx';
import type { PanelTab } from './useThreadSession.ts';
import { AGENTS_CARD_ID } from '../components/thread/panel/AgentsSection.tsx';
import { Empty, ErrorNote, Icon, LinkButton, Loading } from '../components/ui.tsx';
import { href, navigate, openNewThread, type ThreadView } from '../router.ts';
import { reportNotes } from '../requests.ts';
import { canSteer } from '../steer.ts';
import { teamOf } from '../transcript/delegation.ts';
import { runningSubagents } from '../subagents.ts';
import { isAsking } from '@omni/shared/transcript-fold.ts';
import { useApp, useHereName, useNow } from '../store.tsx';
import { limitLabel } from '../limits.ts';
import { useThreadActions } from './useThreadActions.ts';
import { useThreadInterruptKey } from './useThreadInterruptKey.ts';
import { useThreadPanel } from './useThreadPanel.ts';
import { useThreadPresence } from './useThreadPresence.ts';
import { useThreadSession } from './useThreadSession.ts';
import { useTranscriptScroll } from './useTranscriptScroll.ts';
import { useReveal } from './useReveal.ts';
import { useThreadFind } from './useThreadFind.ts';
import { FindBar } from '../components/thread/FindBar.tsx';
import { FindTargetCtx } from '../transcript/find-target.ts';
import { scrollBehavior } from '../motion.ts';
import { tailId } from '@omni/shared/history.ts';
import { blockedNote } from '@omni/shared/thread-machine.ts';

export function ThreadPage({ id, artifact: artifactParam, at, view }: { id: string; artifact?: number; at?: number; view?: ThreadView }) {
  const { mods, tasks, crew: roles, channel: listedChannel } = useApp();
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
    crew,
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
    listed,
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
  const find = useThreadFind({ threadId: id, reveal: history.reveal, release, scrollRef, tail: tailId(history.history) });
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
  const connectors = useThreadConnectors(events);
  // What the running turn is doing, for the header pill's dot and the quick card's.
  const turn = useMemo(() => (thread?.status === 'running' ? turnPhase(events) : null), [events, thread?.status]);
  const agents = useMemo(() => runningSubagents(tasks, id), [tasks, id]);
  const progress = useProgressPanel(events, thread?.status === 'running', asking);
  const selectArtifact = useCallback(
    (artifact: number) => {
      setSelected(artifact);
      setPanelTab('artifacts');
    },
    [setSelected, setPanelTab],
  );
  const panel = useThreadPanel({ artifactParam, loaded: thread !== null, select: selectArtifact });
  const hereName = useHereName();
  const now = useNow(60_000);
  const workCwd = init?.cwd || thread?.cwd || '';
  const openFromCard = (tab: PanelTab) => {
    setPanelTab(tab);
    panel.show();
  };
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
    card.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    setToAgents(false);
  }, [toAgents, panelTab, children, panel.open]);
  // The channel's own step prompts (Channel Settings), from the live channel list so an edit applies without a reload.
  const ownChannel = (thread && listedChannel(thread.channel_id)) ?? channel;
  const prompts = useMemo(() => stepPrompts(ownChannel), [ownChannel]);
  // Show technical details, or a channel with a repo: branch, PRs, changes, terminal and tokens. The context ring shows
  // either way (HeaderActions).
  const code = useShowsCode(ownChannel);
  // The quick card shows in every channel: Show technical details only changes which rows it lists.
  const surface = panel.surface;
  const onPanel = panel.toggle;
  const underway = useMemo(() => stepUnderway(events, queued, slotBusy, prompts), [events, queued, slotBusy, prompts]);
  // A step prompt that never reached the agent (a restart, or a session download that failed): its button says why, and
  // pressing it again resumes that message rather than sending a second copy.
  const parked = useMemo(() => (underway ? null : stepParked(queued, prompts)), [underway, queued, prompts]);
  const { sending, restoring, ask, restore, toggleDone } = useThreadActions({ id, thread, slotBusy, underway, parked, prompts, applyThread, setQueued, setActionError, pin });
  // The branch's PRs and changes: the PRs tab and the Details tab's branch card read them, and the PRs tab's badge.
  const [prs, reloadPRs] = useThreadPR(thread, slotBusy);
  const watch = usePRWatch(thread?.id, prs);
  const changes = useBranchChanges(thread, slotBusy);
  const next = prNext(prs?.pr ?? null, !!changes?.files.length, prompts);
  const step = stepOf(sending, prompts) ?? underway;
  const offered = useMemo(() => prOffered(events, !slotBusy && !queued.length, prs?.pr), [events, slotBusy, queued, prs?.pr]);

  useThreadPresence(id, thread);
  const account = useThreadAccount(id);
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

  const reconnecting = !live && ready;
  const roleName = crewRoleName(thread.role, roles);
  const artifactCount = files.length + shots.length + crew.files.length + crew.shots.length;

  return (
    <div ref={panel.rootRef} className="flex h-full min-h-0">
      <div className={THREAD_COLUMN}>
        <ThreadHeader
          thread={thread}
          channel={channel}
          parent={parent}
          links={links}
          modLines={modLines}
          delegated={known}
          roleName={roleName}
          account={account}
          actions={{
            thread,
            context,
            onCompacted: (t) => {
              applyThread(t, true);
              pin();
            },
            reconnecting,
            onDone: () => void toggleDone(),
            onRestore: () => void restore(),
            restoring,
            panelOpen: surface !== 'collapsed',
            panelSurface: surface,
            onPanel,
            artifactCount,
            asking,
            turn,
            pr: prs?.pr,
            onFind: find.show,
            findOpen: find.open,
          }}
        />

        {/* transcript, with the quick card in its own column so it never covers the conversation */}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            {/* No visible scrollbar beside the quick card, on purpose: see .scroll-none in index.css. */}
            <div ref={scrollRef} onScroll={onScroll} className="scroll-none h-full overflow-y-auto [overflow-anchor:none]">
              {/* A size container too: the reply bubbles widen to 80% by the transcript's width (Transcript.tsx, @lg). */}
              <div ref={contentRef} className="@container mx-auto max-w-4xl px-4 pt-4 pb-10 md:px-6">
                {/* Queued means waiting for a slot: nothing is working yet. */}
                <LinkChannel.Provider value={thread.channel_id}>
                  <ThreadIdCtx.Provider value={id}>
                    <FindTargetCtx.Provider value={find.target}>
                      <Transcript threadId={id} code={code} events={events} running={turnInProgress} cwd={init?.cwd || thread.cwd} known={known} team={members} artifacts={files} reports={reports} history={history} delegated={!!thread.parent_id} limit={limitLabel(thread, now)} elsewhere={!!takeover} />
                    </FindTargetCtx.Provider>
                  </ThreadIdCtx.Provider>
                </LinkChannel.Provider>
                <div className="mt-4 empty:hidden">
                  <GoalLine thread={thread} running={turnInProgress} onSent={(t) => applyThread(t, true)} />
                </div>
                <div className="mt-4 empty:hidden">
                  <CrewQuestions threadId={id} />
                </div>
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
                <SendingMessages threadId={id} pending={listed} />
                {!queued.length && (
                  <>
                    <OpenItemsCard
                      thread={thread}
                      onThread={(t, reply) => {
                        applyThread(t, reply);
                        if (reply) pin();
                      }}
                      onSpawn={(prompt) => openNewThread({ ...sameSettings(thread), prompt })}
                    />
                    <NextThreadCard
                      thread={thread}
                      onThread={(t, reply) => {
                        applyThread(t, reply);
                        if (reply) pin();
                      }}
                    />
                  </>
                )}
              </div>
            </div>
            <FindBar find={find} className="absolute top-3 right-3 z-10 max-w-[calc(100%-1.5rem)] md:right-5" />
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
          {surface === 'card' && (
            <div className={QUICK_CARD_SLOT}>
              <ThreadQuickCard
                thread={thread}
                code={code}
                init={init}
                warm={warm}
                slotBusy={slotBusy}
                prs={prs}
                step={step}
                artifactCount={artifactCount}
                machineName={hereName}
                cwd={workCwd}
                onOpen={openFromCard}
                onOpenPR={(c, n) => navigate(href.pr(c, n))}
                parent={parent}
                delegated={children}
                onOpenThread={(t) => navigate(href.thread(t))}
                asking={asking}
                turn={turn}
                reconnecting={reconnecting}
                connectors={connectors}
                className="shrink-0"
              />
              <ProgressCard threadId={thread.id} panel={progress} className="shrink-0" />
            </div>
          )}
        </div>

        {/* composer, keeping clear of the quick card's column so it centres under the transcript */}
        <div className={`relative shrink-0 bg-bg px-3 pt-1 safe-b-3 md:px-6 md:pb-4 ${surface === 'card' ? COMPOSER_CLEARS_CARD : ''}`}>
          <div className="mx-auto max-w-4xl">
            {actionError && <ErrorNote className="mb-2">{actionError}</ErrorNote>}
            {/* The setup card above says why while the worktree is not ready. */}
            {note && !thread.setup && <ErrorNote className="mb-2">{note}</ErrorNote>}
            <ReplyComposer
              thread={thread}
              canSteer={canSteer(thread.harness, harnesses)}
              // Nothing runs while the worktree is prepared, so there is nothing to stop.
              stop={slotBusy && !thread.setup ? { busy: interrupting, run: () => void interrupt() } : null}
              onSending={pin}
              onSent={(t) => {
                applyThread(t, true);
                pin();
              }}
              // A rename keeps updated_at, so it has to win a tie.
              onChanged={(t) => applyThread(t)}
              machine={{ blocked, handoff, takeover, onChanged: handedOff }}
              asking={asking}
              openPR={offered || step === 'open' ? { busy: step === 'open', prompt: prompts.open, run: () => void ask(prompts.open) } : null}
            />
          </div>
        </div>
      </div>

      {/* panel */}
      {surface === 'inspector' && (
        <aside className="relative shrink-0 py-2 pr-2" style={{ width: panel.width }}>
          <PanelResizeHandle width={panel.width} max={panel.max} onChange={panel.resize} onReset={panel.reset} />
          <div className="panel-in h-full overflow-hidden rounded-[24px] bg-surface shadow-[inset_0_0_0_1px_light-dark(transparent,var(--pane-edge))]">
            <ThreadPanel
              thread={thread}
              code={code}
              files={files}
              shots={shots}
              crewArtifacts={crew}
              selectedArtifact={selectedArtifact}
              onSelect={setSelected}
              tab={panelTab}
              onTab={setPanelTab}
              onClose={panel.closeInspector}
              details={{ channel, roleName, parent, children, init, lastResult, warm, links, agents, onJump: jumpTo, prs, changes, next, step, parked: parked?.step ?? null, onAsk: (p) => void ask(p), onMerged: () => void reloadPRs(), onTab: setPanelTab }}
              prs={{ data: prs, watch, next, step, parked: parked?.step ?? null, openPrompt: prompts.open, onAsk: (p) => void ask(p), onMerged: () => void reloadPRs() }}
            />
          </div>
        </aside>
      )}
    </div>
  );
}
