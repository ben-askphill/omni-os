import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, useApi, type HarnessWithRunning, type ModStatus, type SendMode, type Thread } from '../api.ts';
import { ReplyComposer } from '../components/Composer.tsx';
import { QueuedMessages, Transcript } from '../components/Transcript.tsx';
import { ArtifactsTab } from '../components/thread/panel/ArtifactsTab.tsx';
import { BrowserTab } from '../components/thread/panel/BrowserTab.tsx';
import { DetailsTab } from '../components/thread/panel/DetailsTab.tsx';
import { PANEL_MIN, THREAD_MIN, defaultPanelWidth, PanelResizeHandle } from '../components/thread/panel/PanelResizeHandle.tsx';
import { OPEN_PR_PROMPT, ThreadPR } from '../components/thread/ThreadPR.tsx';
import { ContextMeter } from '../components/thread/ContextMeter.tsx';
import { Avatar, Button, Empty, ErrorNote, Icon, IconButton, LinkButton, Loading, StatusPill, Tabs } from '../components/ui.tsx';
import { href } from '../router.ts';
import { canSteer } from '../steer.ts';
import { teamOf } from '../transcript/delegation.ts';
import { readPref, useApp, useIsMobile, writePref } from '../store.tsx';
import { useThreadInterruptKey } from './useThreadInterruptKey.ts';
import { useThreadSession } from './useThreadSession.ts';
import { useTranscriptScroll } from './useTranscriptScroll.ts';

// xterm.js is large; load it the first time the tab opens.
const TerminalView = lazy(() => import('../components/TerminalView.tsx').then((m) => ({ default: m.TerminalView })));

/** The status lines the thread's mods pinned with $.ui.status, one per plugin, while its process runs. */
function ModStatusLines({ lines }: { lines: ModStatus[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-fg-3" aria-label="Mod status">
      {lines.map((m) => (
        <span key={m.plugin} className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={`${m.plugin}: ${m.text}`}>
          <span className="h-1 w-1 shrink-0 rounded-full bg-fg-4" />
          <span className="shrink-0 font-mono text-[10.5px] text-fg-4">{m.plugin}</span>
          <span className="min-w-0 truncate">{m.text}</span>
        </span>
      ))}
    </div>
  );
}

export function ThreadPage({ id, artifact: artifactParam }: { id: string; artifact?: number }) {
  const { setOpenThread, mods } = useApp();
  const modLines = useMemo(() => mods.filter((m) => m.thread_id === id), [mods, id]);
  const isMobile = useIsMobile();
  // GET /api/harnesses, the same list the reply pills load. Until it arrives, canSteer uses the Cursor fallback.
  const { data: harnesses } = useApi<HarnessWithRunning[]>('/harnesses');
  const {
    thread,
    channel,
    parent,
    children,
    team,
    events,
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
    warm,
    blocked,
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
  } = useThreadSession(id, artifactParam);
  const { scrollRef, contentRef, onScroll, showJump, jump, pin } = useTranscriptScroll(events, thread !== null);
  const known = useMemo(() => [...children, ...team], [children, team]);
  const members = useMemo(() => teamOf(children), [children]);
  const [panelOpen, setPanelOpen] = useState<boolean>(() => readPref('threadPanel', true));
  const [mobilePanel, setMobilePanel] = useState(!!artifactParam);
  const [panelWidth, setPanelWidth] = useState<number | null>(() => {
    const v = readPref<unknown>('threadPanelWidth', null);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
  const [prBusy, setPrBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootWidth, setRootWidth] = useState(0);

  useEffect(() => {
    if (artifactParam) {
      setSelected(artifactParam);
      setPanelTab('artifacts');
      setPanelOpen(true);
      setMobilePanel(true);
    }
  }, [artifactParam, setSelected, setPanelTab]);

  // The sidebar keeps this thread listed under its channel, with live title and status, even once it stops.
  useEffect(() => {
    if (thread) setOpenThread({ id: thread.id, channel_id: thread.channel_id, title: thread.title, status: thread.status, created_at: thread.created_at });
  }, [thread?.id, thread?.channel_id, thread?.title, thread?.status, thread?.created_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setOpenThread(null), [setOpenThread]);

  // The mobile sheet only exists on mobile; a desktop ?artifact= link sets mobilePanel too.
  const sheetOpen = isMobile && mobilePanel;
  useThreadInterruptKey({ slotBusy, interrupting, sheetOpen, interrupt });

  // Escape closes the mobile sheet, unless a modal (lightbox, full-screen artifact) is on top.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc in the terminal is for the shell (vim, less).
      if (e.target instanceof HTMLElement && e.target.closest('.xterm')) return;
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]:not([data-sheet])')) setMobilePanel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  // Open the panel when a new HTML artifact lands on desktop.
  const prevFiles = useRef(0);
  useEffect(() => {
    if (ready && files.length > prevFiles.current && prevFiles.current > 0 && !isMobile && files[files.length - 1]?.kind === 'html') {
      setPanelOpen(true);
    }
    prevFiles.current = files.length;
  }, [files, ready, isMobile]);

  // Track the thread view width so a wide panel never squeezes the transcript below THREAD_MIN.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setRootWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setRootWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [thread !== null]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <ErrorNote className="mt-6" onRetry={() => void load(true)}>
            {error}
          </ErrorNote>
        ) : (
          <Loading label="Loading thread" />
        )}
      </div>
    );
  }

  const openPR = async () => {
    setPrBusy(true);
    setActionError(null);
    try {
      // Mid-turn, wait for the work to finish instead of steering it to commit halfway.
      const mode: SendMode | undefined = slotBusy ? 'queue' : undefined;
      const t = await api.post<Thread>(`/threads/${encodeURIComponent(id)}/messages`, { prompt: OPEN_PR_PROMPT, mode });
      applyThread(t, true);
      pin();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setPrBusy(false);
    }
  };

  const togglePanel = () => {
    if (isMobile) setMobilePanel((v) => !v);
    else
      setPanelOpen((v) => {
        writePref('threadPanel', !v);
        return !v;
      });
  };

  const panel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-2.5 py-2.5">
        <Tabs
          className="min-w-0 flex-1"
          size="sm"
          value={panelTab}
          onChange={setPanelTab}
          tabs={[
            { id: 'artifacts', label: 'Artifacts', badge: files.length ? <span className="font-num text-[10.5px] text-fg-4">{files.length}</span> : undefined },
            { id: 'browser', label: 'Browser', badge: shots.length ? <span className="font-num text-[10.5px] text-fg-4">{shots.length}</span> : undefined },
            { id: 'terminal', label: 'Terminal' },
            { id: 'details', label: 'Details' },
          ]}
        />
        <IconButton icon="x" label="Close panel" onClick={togglePanel} />
      </div>
      <div className="min-h-0 flex-1">
        {panelTab === 'artifacts' && <ArtifactsTab artifacts={files} selected={selectedArtifact} onSelect={setSelected} />}
        {panelTab === 'browser' && <BrowserTab channelId={thread.channel_id} shots={shots} />}
        {panelTab === 'terminal' && (
          <Suspense fallback={<Loading />}>
            <TerminalView threadId={thread.id} cwd={thread.cwd} />
          </Suspense>
        )}
        {panelTab === 'details' && <DetailsTab thread={thread} channel={channel} parent={parent} children={children} init={init} lastResult={lastResult} warm={warm} />}
      </div>
    </div>
  );

  const artifactCount = files.length + shots.length;

  const panelMax = Math.max(PANEL_MIN, (rootWidth || window.innerWidth) - THREAD_MIN);
  const shownPanelWidth = Math.min(Math.max(panelWidth ?? defaultPanelWidth(), PANEL_MIN), panelMax);

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex shrink-0 items-center gap-3 px-3 pt-3 pb-2 md:px-6 md:pt-4">
          <span className="hidden sm:block">
            <Avatar name={channel?.name ?? thread.channel_id} channelIcon={channel?.icon} icon={thread.channel_id === 'conductor' ? 'target' : undefined} size={34} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1 text-[12px] text-fg-3">
              <a href={href.channel(thread.channel_id)} className="shrink-0 hover:text-fg">
                #{channel?.name ?? thread.channel_id}
              </a>
              {parent && (
                <>
                  <Icon name="chevronRight" size={12} className="shrink-0 text-fg-4" />
                  <a href={href.thread(parent.id)} className="min-w-0 truncate hover:text-fg" title={`Delegated from ${parent.title}`}>
                    {parent.title}
                  </a>
                </>
              )}
              {thread.task_id && <span className="ml-1 shrink-0 font-num text-[10.5px] text-fg-4">{thread.task_id}</span>}
            </div>
            <h1 className="truncate font-display text-[16px] leading-snug md:text-[18px]" title={thread.title}>
              {thread.title}
            </h1>
            {modLines.length > 0 && <ModStatusLines lines={modLines} />}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!live && ready && (
              <span className="hidden items-center gap-1.5 font-num text-[11px] text-fg-3 sm:inline-flex" title="Reconnecting to the live stream">
                <span className="pulse h-1.5 w-1.5 rounded-full bg-fg-4" /> Reconnecting
              </span>
            )}
            <ContextMeter
              thread={thread}
              pushed={context}
              onCompacted={(t) => {
                applyThread(t, true);
                pin();
              }}
            />
            <StatusPill status={thread.status} />
            {slotBusy && (
              <Button
                size="sm"
                variant="secondary"
                icon="stop"
                onClick={() => void interrupt()}
                busy={interrupting}
                title="Interrupt the agent (Esc). Messages already sent still run."
                aria-keyshortcuts="Escape"
              >
                {interrupting ? 'Interrupting' : 'Interrupt'}
              </Button>
            )}
            <span className="relative">
              <IconButton icon="panel" label="Artifacts, browser, terminal, details" active={isMobile ? mobilePanel : panelOpen} onClick={togglePanel} />
              {artifactCount > 0 && (
                <span className="pointer-events-none absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-fg px-1 font-num text-[9.5px] text-on-ink">{artifactCount}</span>
              )}
            </span>
          </div>
        </div>

        {/* transcript */}
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={onScroll} className="scroll-thin h-full overflow-y-auto">
            <div ref={contentRef} className="mx-auto max-w-4xl px-4 pt-4 pb-10 md:px-6">
              {error && (
                <ErrorNote className="mb-3" onRetry={() => void load(false)}>
                  {error}
                </ErrorNote>
              )}
              {/* Queued means waiting for a slot: nothing is working yet. */}
              <Transcript threadId={id} events={events} running={turnInProgress} cwd={init?.cwd || thread.cwd} known={known} team={members} artifacts={files} />
              <QueuedMessages items={queued} starting={betweenTurns} />
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
            {blocked && <ErrorNote className="mb-2">{blocked}</ErrorNote>}
            <ReplyComposer
              thread={thread}
              canSteer={canSteer(thread.harness, harnesses)}
              onSent={(t) => {
                applyThread(t, true);
                pin();
              }}
              // A rename keeps updated_at, so it has to win a tie.
              onRenamed={(t) => applyThread(t)}
              extra={
                thread.branch ? <ThreadPR thread={thread} slotBusy={slotBusy} busy={prBusy} onOpen={openPR} /> : undefined
              }
            />
          </div>
        </div>
      </div>

      {/* desktop panel */}
      {!isMobile && panelOpen && (
        <aside className="relative shrink-0 py-2 pr-2" style={{ width: shownPanelWidth }}>
          <PanelResizeHandle
            width={shownPanelWidth}
            max={panelMax}
            onChange={(w, done) => {
              setPanelWidth(w);
              if (done) writePref('threadPanelWidth', w);
            }}
            onReset={() => {
              setPanelWidth(null);
              writePref('threadPanelWidth', null);
            }}
          />
          <div className="panel-in h-full overflow-hidden rounded-[18px] bg-surface">{panel}</div>
        </aside>
      )}

      {/* mobile sheet */}
      {isMobile && mobilePanel && (
        <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label="Thread panel" data-sheet>
          <div className="scrim absolute inset-0" onClick={() => setMobilePanel(false)} />
          <div className="sheet-in absolute inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] bottom-0 flex flex-col overflow-hidden rounded-t-[28px] bg-surface pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-menu)]">
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong" />
            {panel}
          </div>
        </div>
      )}
    </div>
  );
}
