import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, artifactUrl, errorText, parsePayload, useThreadStream, type Artifact, type Channel, type EventRow, type PendingMsg, type Thread, type ThreadDetail } from '../api.ts';
import { ArtifactViewer, kindIcon } from '../components/ArtifactViewer.tsx';
import { ReplyComposer } from '../components/Composer.tsx';
import { QueuedMessages, Transcript } from '../components/Transcript.tsx';
import { Button, Chip, CopyButton, Empty, ErrorNote, Icon, IconButton, LinkButton, Loading, Modal, StatusDot, StatusPill, Tabs } from '../components/ui.tsx';
import { duration, fullDate, plural, relTime } from '../format.ts';
import { href } from '../router.ts';
import { readPref, useApp, useFeed, useIsMobile, writePref } from '../store.tsx';

type PanelTab = 'artifacts' | 'browser' | 'details';

const OPEN_PR_PROMPT = 'Commit your work, push the branch and open a PR with gh. Reply with the PR URL.';

interface InitP {
  model?: string;
  cwd?: string;
  tools?: number;
  mcp?: string[];
}
interface ResultP {
  duration_ms?: number;
  turns?: number;
}

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// ---------- right panel ----------

function ArtifactsTab({ artifacts, selected, onSelect }: { artifacts: Artifact[]; selected: Artifact | undefined; onSelect: (id: number) => void }) {
  if (!artifacts.length) {
    return (
      <Empty icon="layers" title="No artifacts yet">
        Files the agent writes to its artifacts folder show up here and render inline.
      </Empty>
    );
  }
  const list = [...artifacts].reverse();
  return (
    <div className="flex h-full min-h-0 flex-col">
      {list.length > 1 && (
        <div className="scroll-thin max-h-[30%] shrink-0 overflow-y-auto border-b border-line p-1.5">
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
                selected?.id === a.id ? 'bg-surface-3 text-fg' : 'text-fg-2 hover:bg-surface-2'
              }`}
            >
              <Icon name={kindIcon(a.kind)} size={13} className="text-fg-3" />
              <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
              <span className="shrink-0 text-[11px] text-fg-4">{relTime(a.updated_at)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">{selected ? <ArtifactViewer key={selected.id} a={selected} /> : <div className="p-4 text-[13px] text-fg-3">Pick a file.</div>}</div>
    </div>
  );
}

function BrowserTab({ shots }: { shots: Artifact[] }) {
  const [open, setOpen] = useState<Artifact | null>(null);
  if (!shots.length) {
    return (
      <Empty icon="globe" title="No screenshots yet">
        When the agent uses the channel browser, its screenshots collect here.
      </Empty>
    );
  }
  const list = [...shots].reverse();
  const idx = open ? list.findIndex((s) => s.id === open.id) : -1;
  return (
    <div className="scroll-thin h-full overflow-y-auto p-2">
      <div className="grid grid-cols-2 gap-2">
        {list.map((s) => (
          <button key={s.id} type="button" onClick={() => setOpen(s)} className="group overflow-hidden rounded-lg border border-line bg-surface-2 text-left">
            <img src={artifactUrl(s)} alt={s.name} loading="lazy" className="aspect-[4/3] w-full object-cover object-top transition-opacity group-hover:opacity-90" />
            <div className="truncate px-2 py-1 text-[11px] text-fg-3">{relTime(s.updated_at)}</div>
          </button>
        ))}
      </div>
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        title={
          open && (
            <span className="flex items-center gap-2">
              <span className="truncate">{open.name}</span>
              <span className="text-[12px] font-normal text-fg-3">{fullDate(open.updated_at)}</span>
            </span>
          )
        }
      >
        {open && (
          <div className="relative bg-surface-2">
            <img src={artifactUrl(open)} alt={open.name} className="mx-auto max-h-[78vh] w-auto" />
            {idx > 0 && (
              <IconButton icon="chevronLeft" label="Newer" className="absolute top-1/2 left-2 -translate-y-1/2 bg-surface" onClick={() => setOpen(list[idx - 1])} />
            )}
            {idx >= 0 && idx < list.length - 1 && (
              <IconButton icon="chevronRight" label="Older" className="absolute top-1/2 right-2 -translate-y-1/2 bg-surface" onClick={() => setOpen(list[idx + 1])} />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function McpList({ servers }: { servers: string[] }) {
  const [open, setOpen] = useState(false);
  const parsed = servers.map((m) => {
    const cut = m.lastIndexOf(':');
    const name = cut > 0 ? m.slice(0, cut) : m;
    const status = cut > 0 ? m.slice(cut + 1) : '';
    const label = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(name) ? `${name.slice(0, 8)}…` : name;
    return { key: m, name, status, label, ok: !status || status === 'connected' };
  });
  const bad = parsed.filter((p) => !p.ok);
  const good = parsed.filter((p) => p.ok);
  return (
    <div>
      <div className="text-fg-2">
        {good.length} connected
        {bad.length > 0 && <span className="text-warn"> · {bad.length} not connected</span>}
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-2 text-[12px] text-fg-3 underline-offset-2 hover:text-fg hover:underline">
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {bad.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {bad.map((p) => (
            <Chip key={p.key} tone="warn" title={`${p.name} (${p.status})`}>
              {p.label}
            </Chip>
          ))}
        </div>
      )}
      {open && (
        <div className="mt-1 flex flex-wrap gap-1">
          {good.map((p) => (
            <Chip key={p.key} title={p.name}>
              {p.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1.5 text-[12.5px]">
      <dt className="text-fg-3">{k}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

function DetailsTab({
  thread,
  channel,
  parent,
  children,
  init,
  lastResult,
}: {
  thread: Thread;
  channel: Channel | undefined;
  parent: Thread | null;
  children: Thread[];
  init: InitP | null;
  lastResult: ResultP | null;
}) {
  const cwd = init?.cwd || thread.cwd;
  const resume = `cd ${shellQuote(cwd)} && claude --resume ${thread.session_id}`;
  return (
    <div className="scroll-thin h-full overflow-y-auto px-3.5 py-2">
      <dl className="divide-y divide-line">
        <Row k="Channel">
          <a href={href.channel(thread.channel_id)} className="font-medium hover:underline">
            #{channel?.name ?? thread.channel_id}
          </a>
        </Row>
        <Row k="Role">{thread.role ?? <span className="text-fg-3">none</span>}</Row>
        <Row k="Model">
          {thread.model || init?.model || <span className="text-fg-3">default</span>}
          {thread.model && init?.model && init.model !== thread.model && <span className="ml-1 text-fg-3">({init.model})</span>}
        </Row>
        <Row k="Source">
          {thread.source}
          {thread.automation && <span className="text-fg-3"> · {thread.automation}</span>}
        </Row>
        {thread.branch && (
          <Row k="Branch">
            <span className="font-mono text-[12px]">{thread.branch}</span>
          </Row>
        )}
        <Row k="Working dir">
          <span className="font-mono text-[12px]">{cwd}</span>
        </Row>
        <Row k="Session">
          <span className="font-mono text-[12px]">{thread.session_id}</span>
        </Row>
        {thread.task_id && (
          <Row k="Task">
            <span className="font-mono text-[12px]">{thread.task_id}</span>
          </Row>
        )}
        {parent && (
          <Row k="Parent">
            <a href={href.thread(parent.id)} className="inline-flex items-center gap-1.5 hover:underline">
              <StatusDot status={parent.status} size={6} /> {parent.title}
            </a>
          </Row>
        )}
        {init?.mcp && init.mcp.length > 0 && (
          <Row k="MCP">
            <McpList servers={init.mcp} />
          </Row>
        )}
        <Row k="Created">{fullDate(thread.created_at)}</Row>
        <Row k="Updated">{fullDate(thread.updated_at)}</Row>
        {lastResult?.duration_ms != null && (
          <Row k="Last run">
            {duration(lastResult.duration_ms)}
            {lastResult.turns ? <span className="text-fg-3"> · {plural(lastResult.turns, 'turn')}</span> : null}
          </Row>
        )}
      </dl>

      {children.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[12px] font-semibold text-fg-2">Delegated threads</div>
          <div className="space-y-px">
            {children.map((c) => (
              <a key={c.id} href={href.thread(c.id)} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-[12.5px] hover:bg-surface-2">
                <StatusDot status={c.status} size={7} />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.task_id && <span className="shrink-0 font-mono text-[11px] text-fg-4">{c.task_id}</span>}
                <span className="shrink-0 text-[11px] text-fg-3">#{c.channel_id}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-line bg-surface-2 p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-fg-2">Resume in terminal</span>
          <CopyButton text={resume} />
        </div>
        <code className="block font-mono text-[11.5px] break-all text-fg-2">{resume}</code>
      </div>
    </div>
  );
}

// ---------- page ----------

export function ThreadPage({ id, artifact: artifactParam }: { id: string; artifact?: number }) {
  const { setThreadChannel } = useApp();
  const isMobile = useIsMobile();
  const [thread, setThread] = useState<Thread | null>(null);
  const [channel, setChannel] = useState<Channel | undefined>(undefined);
  const [parent, setParent] = useState<Thread | null>(null);
  const [children, setChildren] = useState<Thread[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<number | undefined>(artifactParam);
  const [panelTab, setPanelTab] = useState<PanelTab>('artifacts');
  const [panelOpen, setPanelOpen] = useState<boolean>(() => readPref('threadPanel', true));
  const [mobilePanel, setMobilePanel] = useState(!!artifactParam);
  const [stopping, setStopping] = useState(false);
  const [queued, setQueued] = useState<PendingMsg[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [prBusy, setPrBusy] = useState(false);

  const lastId = useRef(0);
  const seen = useRef(new Set<number>());
  const pending = useRef<EventRow[]>([]);
  const frame = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const addEvents = useCallback((rows: EventRow[]) => {
    const fresh = rows.filter((r) => !seen.current.has(r.id));
    if (!fresh.length) return;
    fresh.forEach((r) => {
      seen.current.add(r.id);
      if (r.id > lastId.current) lastId.current = r.id;
    });
    pending.current.push(...fresh);
    if (frame.current !== undefined) return;
    // Streams arrive in bursts; flush once per frame instead of once per event.
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const batch = pending.current;
      pending.current = [];
      setEvents((prev) => {
        const next = prev.concat(batch);
        if (batch.some((b, i) => (i ? b.id < batch[i - 1].id : prev.length > 0 && b.id < prev[prev.length - 1].id))) next.sort((a, b) => a.id - b.id);
        return next;
      });
    });
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const artifactIds = useRef(new Set<number>());
  const upsertArtifact = useCallback((a: Artifact) => {
    const isNew = !artifactIds.current.has(a.id);
    artifactIds.current.add(a.id);
    if (isNew && a.kind === 'html') {
      setSelected(a.id);
      setPanelTab('artifacts');
    }
    setArtifacts((prev) => (prev.some((x) => x.id === a.id) ? prev.map((x) => (x.id === a.id ? a : x)) : [...prev, a]));
  }, []);
  const artifactParamRef = useRef(artifactParam);

  const load = useCallback(
    async (initial: boolean) => {
      try {
        const d = await api.get<ThreadDetail>(`/threads/${encodeURIComponent(id)}`);
        setThread(d.thread);
        setQueued(d.pending ?? []);
        setChannel(d.channel);
        setParent(d.parent);
        setChildren(d.children);
        setArtifacts(d.artifacts);
        d.artifacts.forEach((a) => artifactIds.current.add(a.id));
        if (initial) {
          const rows = d.events;
          rows.forEach((r) => seen.current.add(r.id));
          lastId.current = rows.length ? Math.max(...rows.map((r) => r.id)) : 0;
          setEvents(rows);
          setReady(true);
          if (!artifactParamRef.current) {
            const visible = d.artifacts.filter((a) => a.kind !== 'screenshot');
            const html = [...visible].reverse().find((a) => a.kind === 'html');
            const pick = html ?? visible[visible.length - 1];
            if (pick) setSelected(pick.id);
            else if (!visible.length) setPanelTab('details');
          }
        } else {
          addEvents(d.events);
        }
        setError(null);
      } catch (e) {
        if ((e as { status?: number }).status === 404) setNotFound(true);
        else setError(errorText(e));
      }
    },
    [id, addEvents],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (artifactParam) {
      setSelected(artifactParam);
      setPanelTab('artifacts');
      setPanelOpen(true);
      setMobilePanel(true);
    }
  }, [artifactParam]);

  useEffect(() => {
    if (thread) setThreadChannel(thread.channel_id);
  }, [thread?.channel_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setThreadChannel(null), [setThreadChannel]);

  const live = useThreadStream(
    id,
    ready,
    lastId,
    (m) => {
      if (m.type === 'event') addEvents([m.event]);
      else if (m.type === 'artifact') upsertArtifact(m.artifact);
      else if (m.type === 'thread') {
        setThread(m.thread);
        if (m.pending) setQueued(m.pending);
      }
    },
    () => void load(false),
  );

  useFeed((e) => {
    if (e.type === 'thread' && e.thread.parent_id === id) {
      setChildren((prev) => (prev.some((c) => c.id === e.thread.id) ? prev.map((c) => (c.id === e.thread.id ? e.thread : c)) : [...prev, e.thread]));
    }
    if (e.type === 'thread' && parent && e.thread.id === parent.id) setParent(e.thread);
  });

  useEffect(() => {
    if (thread && thread.status !== 'running' && thread.status !== 'queued') setStopping(false);
  }, [thread?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the mobile sheet, unless a modal (lightbox, full-screen artifact) is on top.
  useEffect(() => {
    if (!mobilePanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) setMobilePanel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobilePanel]);

  // ----- auto scroll -----
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    nearBottom.current = near;
    if (near) setShowJump(false);
  };
  const jump = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    nearBottom.current = true;
    setShowJump(false);
  };
  const firstScroll = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);
  // Content also grows without new events (web font swap, images, expanded tool rows, the
  // markdown pass). Stay pinned to the bottom through those as long as the user was there.
  useEffect(() => {
    const el = scrollRef.current;
    const inner = contentRef.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [thread !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !events.length) return;
    if (firstScroll.current || nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      firstScroll.current = false;
    } else setShowJump(true);
  }, [events]);

  // ----- derived -----
  const init = useMemo(() => {
    for (let k = events.length - 1; k >= 0; k--) if (events[k].kind === 'init') return parsePayload<InitP>(events[k]);
    return null;
  }, [events]);
  const lastResult = useMemo(() => {
    for (let k = events.length - 1; k >= 0; k--) if (events[k].kind === 'result') return parsePayload<ResultP>(events[k]);
    return null;
  }, [events]);
  const files = useMemo(() => artifacts.filter((a) => a.kind !== 'screenshot'), [artifacts]);
  const shots = useMemo(() => artifacts.filter((a) => a.kind === 'screenshot'), [artifacts]);
  const selectedArtifact = files.find((a) => a.id === selected) ?? files[files.length - 1];

  // Open the panel when a new HTML artifact lands on desktop.
  const prevFiles = useRef(0);
  useEffect(() => {
    if (ready && files.length > prevFiles.current && prevFiles.current > 0 && !isMobile && files[files.length - 1]?.kind === 'html') {
      setPanelOpen(true);
    }
    prevFiles.current = files.length;
  }, [files, ready, isMobile]);

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

  const running = thread.status === 'running' || thread.status === 'queued';

  const stop = async () => {
    setStopping(true);
    setActionError(null);
    try {
      await api.post(`/threads/${encodeURIComponent(id)}/stop`);
    } catch (e) {
      setActionError(errorText(e));
      setStopping(false);
    }
  };

  const openPR = async () => {
    setPrBusy(true);
    setActionError(null);
    try {
      const t = await api.post<Thread>(`/threads/${encodeURIComponent(id)}/messages`, { prompt: OPEN_PR_PROMPT });
      setThread(t);
      nearBottom.current = true;
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
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <Tabs
          className="min-w-0 flex-1"
          value={panelTab}
          onChange={setPanelTab}
          tabs={[
            { id: 'artifacts', label: 'Artifacts', badge: files.length ? <span className="text-[11px] text-fg-4">{files.length}</span> : undefined },
            { id: 'browser', label: 'Browser', badge: shots.length ? <span className="text-[11px] text-fg-4">{shots.length}</span> : undefined },
            { id: 'details', label: 'Details' },
          ]}
        />
        <IconButton icon="x" label="Close panel" onClick={togglePanel} />
      </div>
      <div className="min-h-0 flex-1">
        {panelTab === 'artifacts' && <ArtifactsTab artifacts={files} selected={selectedArtifact} onSelect={setSelected} />}
        {panelTab === 'browser' && <BrowserTab shots={shots} />}
        {panelTab === 'details' && <DetailsTab thread={thread} channel={channel} parent={parent} children={children} init={init} lastResult={lastResult} />}
      </div>
    </div>
  );

  const artifactCount = files.length + shots.length;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 md:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1 text-[12.5px] text-fg-3">
              <a href={href.channel(thread.channel_id)} className="shrink-0 font-medium hover:text-fg">
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
              {thread.task_id && <span className="ml-1 shrink-0 font-mono text-[11px] text-fg-4">{thread.task_id}</span>}
            </div>
            <h1 className="truncate text-[15px] font-semibold tracking-[-0.02em]" title={thread.title}>
              {thread.title}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!live && ready && (
              <span className="hidden text-[11.5px] text-warn sm:inline" title="Reconnecting to the live stream">
                Reconnecting
              </span>
            )}
            <StatusPill status={thread.status} />
            {running && (
              <Button size="sm" variant="secondary" icon="stop" onClick={stop} busy={stopping}>
                Stop
              </Button>
            )}
            <button
              type="button"
              onClick={togglePanel}
              aria-label="Toggle side panel"
              title="Artifacts, browser, details"
              className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 ${
                (isMobile ? mobilePanel : panelOpen) ? 'text-fg' : 'text-fg-3'
              }`}
            >
              <Icon name="panel" size={16} />
              {artifactCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-fg px-1 text-[10px] font-semibold text-bg">
                  {artifactCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* transcript */}
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={onScroll} className="scroll-thin h-full overflow-y-auto">
            <div ref={contentRef} className="mx-auto max-w-3xl px-4 pt-5 pb-8 md:px-6">
              {error && (
                <ErrorNote className="mb-3" onRetry={() => void load(false)}>
                  {error}
                </ErrorNote>
              )}
              <Transcript events={events} running={running} cwd={init?.cwd || thread.cwd} />
              <QueuedMessages items={queued} />
            </div>
          </div>
          {showJump && (
            <button
              type="button"
              onClick={jump}
              className="fade-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-surface px-3 py-1 text-[12px] font-medium shadow-[var(--shadow-menu)]"
            >
              <Icon name="chevronDown" size={13} /> New activity
            </button>
          )}
        </div>

        {/* composer */}
        <div className="shrink-0 border-t border-line bg-bg px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-5">
          <div className="mx-auto max-w-3xl">
            {actionError && <ErrorNote className="mb-2">{actionError}</ErrorNote>}
            <ReplyComposer
              threadId={id}
              status={thread.status}
              onSent={(t) => {
                setThread(t);
                nearBottom.current = true;
              }}
              extra={
                thread.branch ? (
                  <Button size="sm" variant="ghost" icon="pr" onClick={openPR} busy={prBusy} title={OPEN_PR_PROMPT}>
                    Open PR
                  </Button>
                ) : undefined
              }
            />
          </div>
        </div>
      </div>

      {/* desktop panel */}
      {!isMobile && panelOpen && <aside className="w-[clamp(340px,40vw,760px)] shrink-0 border-l border-line">{panel}</aside>}

      {/* mobile sheet */}
      {isMobile && mobilePanel && (
        <div className="fade-in fixed inset-0 z-30 flex flex-col bg-surface pt-[env(safe-area-inset-top)]" role="dialog" aria-label="Thread panel">
          {panel}
        </div>
      )}
    </div>
  );
}
