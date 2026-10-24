import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, useThreadStream, type Artifact, type Channel, type ContextUsage, type HistoryEvent, type PendingMsg, type Thread, type ThreadOpen } from '../api.ts';
import type { InitP, ResultP } from '../components/thread/panel/DetailsTab.tsx';
import { useToast } from '../components/Toaster.tsx';
import { useFeed } from '../store.tsx';
import { parsePayload } from '../format.ts';
import { linksOf, linksWith, NO_LINKS, type ThreadLinks } from '../continue.ts';
import type { HandoffView } from '@omni/shared/handoff.ts';
import { holds } from '../thread-history.ts';
import { useThreadHistory } from './useThreadHistory.ts';

export type PanelTab = 'artifacts' | 'changes' | 'browser' | 'terminal' | 'actions' | 'details';

/**
 * The later of two snapshots of the thread. A send's reply can land after the stream has already
 * moved the thread on (a local command answers in milliseconds), so a reply never wins a tie.
 */
export function newer(prev: Thread | null, next: Thread, reply = false): Thread {
  if (!prev || prev.id !== next.id) return next;
  return prev.updated_at > next.updated_at || (reply && prev.updated_at === next.updated_at) ? prev : next;
}

/**
 * Load, stream, and the thread fields the page renders. Panel chrome stays in the page. The rows are a bounded
 * history (useThreadHistory): `events` is every row held, anchors included, which is what the turn state reads.
 * `at`: an event to open the thread at, such as a search hit; `revealTarget` holds it until the screen scrolls there.
 */
export function useThreadSession(id: string, artifactParam: number | undefined, at?: number) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [channel, setChannel] = useState<Channel | undefined>(undefined);
  const [parent, setParent] = useState<Thread | null>(null);
  const [children, setChildren] = useState<Thread[]>([]);
  const [team, setTeam] = useState<Thread[]>([]);
  const history = useThreadHistory(id);
  // Read only, like every events array the page passes around.
  const events = history.history.rows as HistoryEvent[];
  const [revealTarget, setRevealTarget] = useState<number | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<number | undefined>(artifactParam);
  const [panelTab, setPanelTab] = useState<PanelTab>('artifacts');
  const [stopping, setStopping] = useState(false);
  const [queued, setQueued] = useState<PendingMsg[]>([]);
  const [warm, setWarm] = useState<boolean | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<HandoffView | null>(null);
  const [links, setLinks] = useState<ThreadLinks>(NO_LINKS);
  // The newest context reading the stream pushed. The meter loads its first one itself.
  const [context, setContext] = useState<ContextUsage | null>(null);

  const toast = useToast();
  const { prepare, open, append, snapshot, reveal } = history;
  const atRef = useRef(at);
  atRef.current = at;
  // The `at` the first load or a later reveal already took, so each is scrolled to once.
  const revealed = useRef<number | undefined>(undefined);

  const artifactIds = useRef(new Set<number>());
  const upsertArtifact = useCallback((a: Artifact) => {
    const isNew = !artifactIds.current.has(a.id);
    artifactIds.current.add(a.id);
    if (isNew && a.kind === 'html') {
      setSelected(a.id);
      // Never pull Ben out of the shell mid-command, the changes he is reading or a run's output.
      setPanelTab((t) => (t === 'terminal' || t === 'changes' || t === 'actions' ? t : 'artifacts'));
    }
    setArtifacts((prev) => (prev.some((x) => x.id === a.id) ? prev.map((x) => (x.id === a.id ? a : x)) : [...prev, a]));
  }, []);
  const artifactParamRef = useRef(artifactParam);

  /** The thread's state from a detail: the first load's, or a stream sync's. */
  const applyDetail = useCallback((d: ThreadOpen) => {
    setThread((prev) => newer(prev, d.thread));
    setQueued(d.pending ?? []);
    if (d.live !== undefined) setWarm(d.live);
    setBlocked(d.blocked ?? null);
    setHandoff(d.handoff ?? null);
    setChannel(d.channel);
    setParent(d.parent);
    setChildren(d.children);
    setTeam(d.team ?? []);
    setArtifacts(d.artifacts);
    d.artifacts.forEach((a) => artifactIds.current.add(a.id));
  }, []);

  const load = useCallback(
    async () => {
      try {
        const d = await api.get<ThreadOpen>(`/threads/${encodeURIComponent(id)}?history=recent`);
        const target = atRef.current;
        // Before any state is set, so the thread first renders with the hit's page already held.
        const opened = await prepare(d, target);
        applyDetail(d);
        setLinks(linksOf(d));
        open(opened);
        // Not held when its page failed: the reveal below tries again and says why.
        if (target && holds(opened, target)) {
          revealed.current = target;
          setRevealTarget(target);
        }
        setReady(true);
        if (!artifactParamRef.current) {
          const visible = d.artifacts.filter((a) => a.kind !== 'screenshot');
          const html = [...visible].reverse().find((a) => a.kind === 'html');
          const pick = html ?? visible[visible.length - 1];
          if (pick) setSelected(pick.id);
          else if (!visible.length) setPanelTab('details');
        }
        setError(null);
      } catch (e) {
        if ((e as { status?: number }).status === 404) setNotFound(true);
        else setError(errorText(e));
      }
    },
    [id, prepare, open, applyDetail],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A search hit opened while the thread is already open: load its page if needed, then scroll to it.
  useEffect(() => {
    if (!ready || !at || revealed.current === at) return;
    revealed.current = at;
    void reveal(at).then((ok) => (ok ? setRevealTarget(at) : toast({ icon: 'alert', title: 'Could not load that message', body: 'The thread opened at its latest messages.' })));
  }, [ready, at, reveal, toast]);
  const clearReveal = useCallback(() => setRevealTarget(null), []);

  const live = useThreadStream(
    id,
    ready,
    history.lastId,
    (m) => {
      switch (m.type) {
        case 'event':
          append([m.event]);
          break;
        case 'sync':
          applyDetail(m.detail);
          if (m.snapshot) snapshot(m.detail);
          break;
        case 'artifact':
          upsertArtifact(m.artifact);
          break;
        case 'thread':
          setThread((prev) => newer(prev, m.thread));
          if (m.pending) setQueued(m.pending);
          if (m.live !== undefined) setWarm(m.live);
          setBlocked(m.blocked ?? null);
          setHandoff(m.handoff ?? null);
          break;
        case 'context':
          setContext(m.context);
          break;
        case 'mod_toast':
          // A mod's $.ui.toast. Only whoever has the thread open sees it; it is never stored.
          toast({ icon: 'bell', title: m.toast.text, body: m.toast.plugin, timeout: Math.min(15_000, Math.max(1500, m.toast.timeout_ms ?? 4000)) });
          break;
        default: {
          const unreachable: never = m;
          void unreachable;
        }
      }
    },
  );

  useFeed((e) => {
    if (e.type !== 'thread') return;
    const t = e.thread;
    const upsert = (prev: Thread[]) => (prev.some((c) => c.id === t.id) ? prev.map((c) => (c.id === t.id ? t : c)) : [...prev, t]);
    if (t.parent_id === id) setChildren(upsert);
    // A member of a team this thread started: its delegation card shows the change.
    if (t.source === 'team' && children.some((c) => c.id === t.parent_id)) setTeam(upsert);
    if (parent && t.id === parent.id) setParent(t);
    setLinks((prev) => linksWith(prev, id, t));
  });

  // Queued or running: the header interrupt and the composer treat both as busy.
  const slotBusy = thread?.status === 'running' || thread?.status === 'queued';
  // Running only. Queued is waiting for a slot, so the transcript does not show a working turn.
  const turnInProgress = thread?.status === 'running';
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
    if (!slotBusy) setStopping(false);
  }, [slotBusy]);
  useEffect(() => setStopping(false), [lastResultId]);
  useEffect(() => {
    if (!stopping) return;
    const t = setTimeout(() => setStopping(false), 15_000);
    return () => clearTimeout(t);
  }, [stopping]);

  const applyThread = useCallback((next: Thread, reply = false) => {
    setThread((prev) => newer(prev, next, reply));
  }, []);

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

  return {
    thread,
    channel,
    parent,
    children,
    team,
    events,
    history,
    revealTarget,
    clearReveal,
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
  };
}
