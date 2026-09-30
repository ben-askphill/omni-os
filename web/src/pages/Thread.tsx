import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, artifactUrl, errorText, parsePayload, useThreadStream, type Artifact, type Channel, type EventRow, type PendingMsg, type PRSummary, type SendMode, type Thread, type ThreadDetail } from '../api.ts';
import { ArtifactViewer, kindIcon } from '../components/ArtifactViewer.tsx';
import { ReplyComposer } from '../components/Composer.tsx';
import { LiveBrowser } from '../components/LiveBrowser.tsx';
import { CAPABILITIES, isHarnessId } from '../../../server/harness/types.ts';
import { HarnessMark } from '../components/brand.tsx';
import { QueuedMessages, Transcript } from '../components/Transcript.tsx';
import { Avatar, Button, Chip, CopyButton, Empty, ErrorNote, Icon, IconButton, LinkButton, Loading, Modal, StatusDot, StatusPill, Tabs } from '../components/ui.tsx';
import { duration, fullDate, plural, relTime } from '../format.ts';
import { href } from '../router.ts';
import { readPref, useApp, useFeed, useIsMobile, writePref } from '../store.tsx';

type PanelTab = 'artifacts' | 'browser' | 'details';

const OPEN_PR_PROMPT = 'Commit your work, push the branch and open a PR with gh. Reply with the PR URL.';

/** open, draft, merged or closed, with the chip tone the PRs page uses. */
function prBadge(p: PRSummary) {
  const state = p.state ?? 'OPEN';
  const label = state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : p.isDraft ? 'draft' : 'open';
  return { label, tone: (label === 'open' ? 'live' : label === 'merged' ? 'done' : 'outline') as 'live' | 'done' | 'outline' };
}

/**
 * The composer's PR slot: Open PR until the branch has a PR, then that PR and whether it merged.
 * It opens a list of every PR from the branch, and offers Open PR there while none is open.
 */
function ThreadPR({ thread, running, busy, onOpen }: { thread: Thread; running: boolean; busy: boolean; onOpen: () => void }) {
  // undefined until the first answer, so the button does not flash before the PR shows.
  const [data, setData] = useState<{ pr: PRSummary | null; prs: PRSummary[] } | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const r = await api.get<{ pr: PRSummary | null; prs?: PRSummary[] }>(`/threads/${encodeURIComponent(thread.id)}/pr`);
      setData({ pr: r.pr, prs: r.prs ?? (r.pr ? [r.pr] : []) });
    } catch {
      setData((prev) => prev ?? { pr: null, prs: [] });
    }
  }, [thread.id]);
  // Again when a turn ends (it may have opened the PR), and every minute to catch a merge.
  useEffect(() => {
    if (!running) void load();
  }, [load, running, thread.branch]);
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => clearInterval(tick);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!data) return null;
  const { pr, prs } = data;
  if (!pr)
    return (
      <Button size="sm" variant="ghost" icon="pr" onClick={onOpen} busy={busy} title={OPEN_PR_PROMPT}>
        Open PR
      </Button>
    );
  const badge = prBadge(pr);
  const canOpen = !prs.some((p) => (p.state ?? 'OPEN') === 'OPEN');
  return (
    <div ref={wrap} className="relative">
      <Button
        size="sm"
        variant="ghost"
        icon="pr"
        busy={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={pr.title}
        onClick={() => setOpen((v) => !v)}
        className="gap-1.5"
      >
        #{pr.number}
        <Chip tone={badge.tone}>{badge.label}</Chip>
        {prs.length > 1 && <span className="text-fg-4">+{prs.length - 1}</span>}
        <Icon name="chevronDown" size={13} className="text-fg-4" />
      </Button>
      {open && (
        <div role="menu" aria-label="Pull requests from this branch" data-up className="pik-card bottom-[calc(100%+8px)] left-0 w-[min(340px,calc(100vw-32px))]">
          <div className="px-2 pt-1 pb-1.5 text-[11.5px] text-fg-4">
            {plural(prs.length, 'PR')} from <span className="font-mono">{thread.branch}</span>
          </div>
          <div className="scroll-thin max-h-[280px] overflow-y-auto">
            {prs.map((p) => {
              const b = prBadge(p);
              return (
                <a
                  key={p.number}
                  role="menuitem"
                  href={href.pr(thread.channel_id, p.number)}
                  onClick={() => setOpen(false)}
                  className="pik-row hover:bg-[var(--wash)]"
                >
                  <span className="w-9 shrink-0 text-[12.5px] text-fg-3 tabular-nums">#{p.number}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] text-fg">{p.title}</span>
                    <span className="truncate text-[11.5px] text-fg-4">{relTime(p.updatedAt)}</span>
                  </span>
                  <Chip tone={b.tone}>{b.label}</Chip>
                </a>
              );
            })}
          </div>
          {canOpen && (
            <button
              type="button"
              role="menuitem"
              title={OPEN_PR_PROMPT}
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
              className="pik-row mt-1 text-[13px] text-fg-2 shadow-[inset_0_1px_0_var(--line)] hover:bg-[var(--wash)]"
            >
              <Icon name="pr" size={14} /> Open a new PR
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface InitP {
  model?: string;
  cwd?: string;
  tools?: number;
  mcp?: string[];
}
interface ResultP {
  duration_ms?: number;
  turns?: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
}

// Desktop panel width in px. null means the default, clamp(340px, 40vw, 760px).
const PANEL_MIN = 320;
const THREAD_MIN = 420; // keep the transcript usable next to a wide panel
const defaultPanelWidth = () => Math.min(760, Math.max(340, window.innerWidth * 0.4));

function PanelResizeHandle({ width, max, onChange, onReset }: { width: number; max: number; onChange: (w: number, done: boolean) => void; onReset: () => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);
  const clampW = (w: number) => Math.round(Math.min(Math.max(w, PANEL_MIN), Math.max(PANEL_MIN, max)));
  const end = () => {
    drag.current = null;
    setActive(false);
    document.body.classList.remove('col-resizing');
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      className="group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize touch-none justify-center outline-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        setActive(true);
        document.body.classList.add('col-resizing');
      }}
      onPointerMove={(e) => {
        // The panel sits on the right, so dragging left grows it.
        if (drag.current) onChange(clampW(drag.current.w + drag.current.x - e.clientX), false);
      }}
      onPointerUp={(e) => {
        if (drag.current) onChange(clampW(drag.current.w + drag.current.x - e.clientX), true);
        end();
      }}
      onLostPointerCapture={() => {
        if (drag.current) onChange(width, true);
        end();
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === 'ArrowLeft') onChange(clampW(width + step), true);
        else if (e.key === 'ArrowRight') onChange(clampW(width - step), true);
        else if (e.key === 'Home') onChange(clampW(PANEL_MIN), true);
        else if (e.key === 'End') onChange(clampW(max), true);
        else return;
        e.preventDefault();
      }}
    >
      <span className={`my-auto h-10 w-[3px] rounded-full transition-colors ${active ? 'bg-fg-3' : 'bg-transparent group-hover:bg-line-strong group-focus-visible:bg-fg-3'}`} />
    </div>
  );
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
        <div className="scroll-thin max-h-[30%] shrink-0 overflow-y-auto px-2 pb-2">
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              data-on={selected?.id === a.id || undefined}
              aria-pressed={selected?.id === a.id}
              className={`hov flex h-8 w-full min-w-0 items-center gap-2 rounded-full px-3 text-left text-[12.5px] [--hov:var(--surface-3)] ${selected?.id === a.id ? 'text-fg' : 'text-fg-2'}`}
            >
              <Icon name={kindIcon(a.kind)} size={13} className="text-fg-3" />
              <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
              <span className="shrink-0 font-num text-[10.5px] text-fg-4">{relTime(a.updated_at)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 bg-bg">{selected ? <ArtifactViewer key={selected.id} a={selected} /> : <div className="p-4 text-[13px] text-fg-3">Pick a file.</div>}</div>
    </div>
  );
}

/**
 * The channel's browser, live: the same Chrome the agent drives, which Ben can click and type in.
 * The screenshots the agent saved sit one click away.
 */
function BrowserTab({ channelId, shots }: { channelId: string; shots: Artifact[] }) {
  const [view, setView] = useState<'live' | 'shots'>('live');
  const [expanded, setExpanded] = useState(false);
  const extra = (
    <>
      <span className="relative">
        <IconButton icon="image" label={`Screenshots${shots.length ? ` (${shots.length})` : ''}`} size={15} active={view === 'shots'} onClick={() => setView((v) => (v === 'shots' ? 'live' : 'shots'))} />
        {shots.length > 0 && <span className="pointer-events-none absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-fg-3" />}
      </span>
      {view === 'live' && <IconButton icon="maximize" label="Expand" size={15} onClick={() => setExpanded(true)} />}
    </>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {view === 'shots' ? (
        <>
          <div className="flex items-center gap-1 px-2 pb-2">
            <Button size="sm" variant="ghost" icon="chevronLeft" onClick={() => setView('live')}>
              Live browser
            </Button>
            <span className="flex-1" />
            <span className="px-2 font-num text-[11px] text-fg-4">{plural(shots.length, 'screenshot')}</span>
          </div>
          <div className="min-h-0 flex-1">
            <Screenshots shots={shots} />
          </div>
        </>
      ) : expanded ? (
        <Empty icon="browser" title="Open in the expanded view">
          <Button size="sm" onClick={() => setExpanded(false)}>
            Bring it back here
          </Button>
        </Empty>
      ) : (
        <LiveBrowser channelId={channelId} extra={extra} />
      )}
      <Modal open={expanded} onClose={() => setExpanded(false)} wide title="Browser">
        <div className="h-[78vh] pb-3">
          <LiveBrowser channelId={channelId} fill />
        </div>
      </Modal>
    </div>
  );
}

function Screenshots({ shots }: { shots: Artifact[] }) {
  const [open, setOpen] = useState<Artifact | null>(null);
  if (!shots.length) {
    return (
      <Empty icon="globe" title="No screenshots yet">
        When the agent takes a screenshot in the channel browser, it collects here.
      </Empty>
    );
  }
  const list = [...shots].reverse();
  const idx = open ? list.findIndex((s) => s.id === open.id) : -1;
  return (
    <div className="scroll-thin h-full overflow-y-auto px-2.5 pb-2.5">
      <div className="grid grid-cols-2 gap-2">
        {list.map((s) => (
          <button key={s.id} type="button" onClick={() => setOpen(s)} className="press group overflow-hidden rounded-2xl bg-bg p-1 text-left">
            <img src={artifactUrl(s)} alt={s.name} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover object-top shadow-[inset_0_0_0_1px_var(--line)] transition-opacity group-hover:opacity-90" />
            <div className="truncate px-1.5 pt-1 pb-0.5 font-num text-[10.5px] text-fg-4">{relTime(s.updated_at)}</div>
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
              <span className="font-num text-[11px] text-fg-3">{fullDate(open.updated_at)}</span>
            </span>
          )
        }
      >
        {open && (
          <div className="relative bg-surface-2">
            <img src={artifactUrl(open)} alt={open.name} className="mx-auto max-h-[78vh] w-auto" />
            {idx > 0 && (
              <IconButton icon="chevronLeft" label="Newer" className="float absolute top-1/2 left-3 -translate-y-1/2" onClick={() => setOpen(list[idx - 1])} />
            )}
            {idx >= 0 && idx < list.length - 1 && (
              <IconButton icon="chevronRight" label="Older" className="float absolute top-1/2 right-3 -translate-y-1/2" onClick={() => setOpen(list[idx + 1])} />
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
        {bad.length > 0 && <span className="text-fg-2"> · {bad.length} not connected</span>}
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-2 text-[12px] text-fg-3 underline-offset-2 hover:text-fg hover:underline">
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {bad.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {bad.map((p) => (
            <Chip key={p.key} tone="needs" title={`${p.name} (${p.status})`}>
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
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 px-3.5 py-2 text-[12.5px]">
      <dt className="pt-px text-fg-3">{k}</dt>
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
  warm,
}: {
  thread: Thread;
  channel: Channel | undefined;
  parent: Thread | null;
  children: Thread[];
  init: InitP | null;
  lastResult: ResultP | null;
  warm: boolean | undefined;
}) {
  const cwd = init?.cwd || thread.cwd;
  const remote = thread.harness === 'hermes';
  const resumeCmd: Record<string, string> = {
    'claude-code': `claude --resume ${thread.session_id}`,
    codex: `codex resume ${thread.session_id}`,
    cursor: `cursor-agent --resume ${thread.session_id}`,
  };
  const resume = remote ? '' : `cd ${shellQuote(cwd)} && ${resumeCmd[thread.harness] ?? resumeCmd['claude-code']}`;
  return (
    <div className="scroll-thin h-full overflow-y-auto px-2.5 pb-3">
      <dl className="divide-y divide-line rounded-[20px] bg-bg py-1">
        <Row k="Channel">
          <a href={href.channel(thread.channel_id)} className="font-medium hover:underline">
            #{channel?.name ?? thread.channel_id}
          </a>
        </Row>
        <Row k="Role">{thread.role ?? <span className="text-fg-3">none</span>}</Row>
        <Row k="Harness">
          <HarnessMark harness={thread.harness} withLabel />
        </Row>
        <Row k="Model">
          {thread.model || init?.model || <span className="text-fg-3">default</span>}
          {thread.model && init?.model && init.model !== thread.model && <span className="ml-1 text-fg-3">({init.model})</span>}
        </Row>
        <Row k="Effort">{thread.effort || <span className="text-fg-3">default</span>}</Row>
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
          {remote ? (
            <span className="text-fg-3">Hermes server, not an Omni worktree</span>
          ) : (
            <span className="font-mono text-[12px]">{cwd}</span>
          )}
        </Row>
        <Row k="Session">
          <span className="font-mono text-[12px]">{thread.session_id}</span>
          {warm !== undefined && (
            <div className="mt-0.5 flex items-center gap-1.5 text-fg-3">
              <StatusDot status={warm ? 'done' : 'imported'} size={6} />
              {warm ? 'Live, the next message starts instantly' : 'Not running, the next message starts a new process'}
            </div>
          )}
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
            {lastResult.model ? <span className="text-fg-3"> · {lastResult.model}</span> : null}
            {lastResult.input_tokens != null ? (
              <span className="text-fg-3">
                {' '}
                · {lastResult.input_tokens} in / {lastResult.output_tokens ?? 0} out
              </span>
            ) : null}
          </Row>
        )}
      </dl>

      {children.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center px-2">
            <span className="caption">Delegated threads</span>
            <span className="ml-auto font-num text-[11px] text-fg-3">{children.length}</span>
          </div>
          <div className="rounded-[20px] bg-bg p-1">
            {children.map((c) => (
              <a key={c.id} href={href.thread(c.id)} className="hov flex h-9 min-w-0 items-center gap-2.5 rounded-full px-3 text-[12.5px] [--hov:var(--surface)]">
                <StatusDot status={c.status} size={7} />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.task_id && <span className="shrink-0 font-mono text-[11px] text-fg-4">{c.task_id}</span>}
                <span className="shrink-0 text-[11px] text-fg-3">#{c.channel_id}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {remote ? (
        <div className="mt-4 rounded-[20px] bg-bg p-3.5">
          <div className="caption mb-2">Remote session</div>
          <p className="text-[12.5px] leading-relaxed text-fg-2">
            This thread runs on the Hermes server. Another message here resumes <span className="font-mono">{thread.session_id}</span>.
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-[20px] bg-bg p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="caption">Resume in terminal</span>
            <CopyButton text={resume} />
          </div>
          <code className="block rounded-xl bg-surface px-3 py-2.5 font-mono text-[11.5px] break-all text-fg-2">{resume}</code>
        </div>
      )}
    </div>
  );
}

// ---------- page ----------

/**
 * The later of two snapshots of the thread. A send's reply can land after the stream has already
 * moved the thread on (a local command answers in milliseconds), so a reply never wins a tie.
 */
function newer(prev: Thread | null, next: Thread, reply = false): Thread {
  if (!prev || prev.id !== next.id) return next;
  return prev.updated_at > next.updated_at || (reply && prev.updated_at === next.updated_at) ? prev : next;
}

export function ThreadPage({ id, artifact: artifactParam }: { id: string; artifact?: number }) {
  const { setOpenThread } = useApp();
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
  const [panelWidth, setPanelWidth] = useState<number | null>(() => {
    const v = readPref<unknown>('threadPanelWidth', null);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootWidth, setRootWidth] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [queued, setQueued] = useState<PendingMsg[]>([]);
  const [warm, setWarm] = useState<boolean | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
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
        setThread((prev) => newer(prev, d.thread));
        setQueued(d.pending ?? []);
        if (d.live !== undefined) setWarm(d.live);
        setBlocked(d.blocked ?? null);
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

  // The sidebar keeps this thread listed under its channel, with live title and status, even once it stops.
  useEffect(() => {
    if (thread) setOpenThread({ id: thread.id, channel_id: thread.channel_id, title: thread.title, status: thread.status, created_at: thread.created_at });
  }, [thread?.id, thread?.channel_id, thread?.title, thread?.status, thread?.created_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setOpenThread(null), [setOpenThread]);

  const live = useThreadStream(
    id,
    ready,
    lastId,
    (m) => {
      if (m.type === 'event') addEvents([m.event]);
      else if (m.type === 'artifact') upsertArtifact(m.artifact);
      else if (m.type === 'thread') {
        setThread((prev) => newer(prev, m.thread));
        if (m.pending) setQueued(m.pending);
        if (m.live !== undefined) setWarm(m.live);
        setBlocked(m.blocked ?? null);
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

  const running = thread?.status === 'running' || thread?.status === 'queued';
  // The mobile sheet only exists on mobile; a desktop ?artifact= link sets mobilePanel too.
  const sheetOpen = isMobile && mobilePanel;
  // Also covers "Interrupt and send" while the server really interrupts: that message stays sent until the agent reads it.
  const interrupting = stopping || queued.some((m) => m.state === 'sent' && m.mode === 'interrupt');

  const interrupt = useCallback(async () => {
    setStopping(true);
    setActionError(null);
    try {
      await api.post(`/threads/${encodeURIComponent(id)}/stop`);
    } catch (e) {
      setActionError(errorText(e));
      setStopping(false);
    }
  }, [id]);

  // "Interrupting" lasts until the turn ends. Queued steers can keep the thread running past the
  // interrupt, so a new result also clears it, and a timer covers a lost update.
  const lastResultId = useMemo(() => {
    for (let k = events.length - 1; k >= 0; k--) if (events[k].kind === 'result') return events[k].id;
    return 0;
  }, [events]);
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);
  useEffect(() => setStopping(false), [lastResultId]);
  useEffect(() => {
    if (!stopping) return;
    const t = setTimeout(() => setStopping(false), 15_000);
    return () => clearTimeout(t);
  }, [stopping]);

  // Esc interrupts a busy thread. Capture phase, so it sees the page before any other Escape
  // handler closes its layer: an open modal, lightbox, drawer, sheet, menu or list keeps Esc for itself.
  useEffect(() => {
    if (!running || interrupting || sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (document.querySelector('[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      // Esc in another field (sidebar search, a form) belongs to that field. The reply composer is the exception.
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || el.matches('input, select') || (el.matches('textarea') && !el.hasAttribute('data-reply-composer')))) return;
      void interrupt();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [running, interrupting, sheetOpen, interrupt]);

  // Escape closes the mobile sheet, unless a modal (lightbox, full-screen artifact) is on top.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]:not([data-sheet])')) setMobilePanel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

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
  // No activity since the last turn ended, so the first sent message starts the next turn instead of steering one.
  const betweenTurns = useMemo(() => {
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k];
      if (e.kind === 'result' || e.kind === 'error') return true;
      if (e.kind === 'user' || e.kind === 'crew_report') {
        if (!parsePayload<{ dropped?: boolean }>(e).dropped) return false;
      } else if (e.kind === 'tool_use' || e.kind === 'tool_result' || e.kind === 'assistant_text') return false;
    }
    return true;
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
      const mode: SendMode | undefined = running ? 'queue' : undefined;
      const t = await api.post<Thread>(`/threads/${encodeURIComponent(id)}/messages`, { prompt: OPEN_PR_PROMPT, mode });
      setThread((prev) => newer(prev, t, true));
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
            { id: 'details', label: 'Details' },
          ]}
        />
        <IconButton icon="x" label="Close panel" onClick={togglePanel} />
      </div>
      <div className="min-h-0 flex-1">
        {panelTab === 'artifacts' && <ArtifactsTab artifacts={files} selected={selectedArtifact} onSelect={setSelected} />}
        {panelTab === 'browser' && <BrowserTab channelId={thread.channel_id} shots={shots} />}
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
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!live && ready && (
              <span className="hidden items-center gap-1.5 font-num text-[11px] text-fg-3 sm:inline-flex" title="Reconnecting to the live stream">
                <span className="pulse h-1.5 w-1.5 rounded-full bg-fg-4" /> Reconnecting
              </span>
            )}
            <StatusPill status={thread.status} />
            {running && (
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
              <IconButton icon="panel" label="Artifacts, browser, details" active={isMobile ? mobilePanel : panelOpen} onClick={togglePanel} />
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
              <Transcript threadId={id} events={events} running={thread.status === 'running'} cwd={init?.cwd || thread.cwd} />
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
              canSteer={isHarnessId(thread.harness) ? CAPABILITIES[thread.harness].steer : thread.harness !== 'cursor'}
              onSent={(t) => {
                setThread((prev) => newer(prev, t, true));
                nearBottom.current = true;
              }}
              // A rename keeps updated_at, so it has to win a tie.
              onRenamed={(t) => setThread((prev) => newer(prev, t))}
              extra={
                thread.branch ? <ThreadPR thread={thread} running={running} busy={prBusy} onOpen={openPR} /> : undefined
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
