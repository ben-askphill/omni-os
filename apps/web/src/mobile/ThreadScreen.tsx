import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorText, useApi, type Artifact, type BranchChanges, type PendingMsg, type Thread } from '../api.ts';
import { harnessLabel, OmniMark } from '../components/brand.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { SwitchLine } from '../components/Transcript.tsx';
import { ASKING_LABEL, QuestionCard } from '../components/thread/QuestionCard.tsx';
import { OPEN_PR_PROMPT, useThreadPR } from '../components/thread/ThreadPR.tsx';
import { CloudAgentCard } from '../components/thread/CloudAgentCard.tsx';
import { handOff, HandoffCard, useHandoffTargets } from '../components/thread/Handoff.tsx';
import { deviceRows } from '../handoff.ts';
import { Button, ErrorNote, Icon, Loader, StatusDot, StatusPill } from '../components/ui.tsx';
import { changesView } from '../changes.ts';
import { duration, plural } from '../format.ts';
import { ArtifactThumb } from '../pages/Artifacts.tsx';
import { canMarkDone, reasonOf } from '../needs-you.ts';
import { isOmnis, parkedLabel } from '../requests.ts';
import { sendThreadToGrokBot } from '../grokbot.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { needsCard } from './activity.ts';
import { MoComposer, type ComposerChip } from './MoComposer.tsx';
import { NeedsActions, NeedsCardView } from './NeedsCard.tsx';
import { BranchingFrom } from './BaseSheet.tsx';
import { MoAvatar, MoBubble, MoDiff, MoEmpty, MoGroup, MoHeader, MoListRow, MoRound, MoSheet, MoStripes } from './parts.tsx';
import { shortTime } from './rows.ts';
import { useShell, useThread } from './shell.tsx';
import { threadView, type NowDoing, type PlanView, type TurnView } from './thread-view.ts';

const DRAWN = new Set(['html', 'image', 'svg']);
const ext = (name: string) => (name.includes('.') ? name.split('.').pop()! : 'file');
const ENDED: Record<string, [string, string]> = { done: ['Done', 'Done in'], failed: ['Failed', 'Failed after'], stopped: ['Stopped', 'Stopped after'] };

function MoProse({ text }: { text: string }) {
  return <Markdown text={text} className="text-[15px] leading-[1.6] text-pretty" />;
}

function Outcome({ t, harness }: { t: TurnView; harness: string }) {
  const took = duration(t.result?.duration_ms);
  const [word, after] = ENDED[t.status] ?? ['Ended', 'Ended after'];
  return (
    <div className="flex items-center gap-2 text-[12.5px] leading-[1.3] text-fg-3 tabular-nums">
      <StatusDot status={t.status} size={8} />
      {[took ? `${after} ${took}` : word, t.steps ? plural(t.steps, 'step') : null, harnessLabel(harness)].filter(Boolean).join(' · ')}
    </div>
  );
}

/** A long error, four lines until tapped. */
function Clamped({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen((o) => !o)} className={`m-0 text-left font-mono text-[12.5px] leading-[1.5] break-words whitespace-pre-wrap text-fg-2 ${open ? '' : 'line-clamp-4'}`}>
      {text}
    </button>
  );
}

function StepsRow({ t, live, onClick }: { t: TurnView; live?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mo-press flex h-11 items-center gap-2.5 rounded-full bg-surface px-3.5 text-left text-[13.5px] leading-none text-fg-2">
      <Icon name="tool" size={15} />
      <span className="flex-1 tabular-nums">
        {live ? `${plural(t.steps, 'step')} so far` : plural(t.steps, 'step')}
        {t.failed > 0 && (
          <>
            <span className="text-fg-3"> · </span>
            <span className="inline-flex items-center gap-[5px]">
              <StatusDot status="failed" size={7} />
              {t.failed} failed
            </span>
          </>
        )}
      </span>
      <Icon name="chevronRight" size={15} className="text-fg-4" />
    </button>
  );
}

function ArtifactCard({ a, sub, onOpen }: { a: Artifact; sub: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="mo-press flex flex-col overflow-hidden rounded-[20px] bg-surface text-left">
      <div className="relative mx-2 mt-2 h-[150px] overflow-hidden rounded-[14px] bg-elev shadow-[var(--shadow-card)]">
        {DRAWN.has(a.kind) ? <ArtifactThumb a={a} scale={0.53} /> : <MoStripes label={ext(a.name)} />}
      </div>
      <div className="flex items-center gap-2.5 px-3.5 pt-2.5 pb-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-mono text-[13px] leading-[1.3]">{a.name}</span>
          <span className="truncate text-[12px] leading-[1.3] text-fg-3">{sub}</span>
        </span>
        <Icon name="chevronRight" size={15} className="text-fg-4" />
      </div>
    </button>
  );
}

function ChangesCard({ files, onOpen }: { files: { path: string; add: number; del: number }[]; onOpen: () => void }) {
  const shown = files.slice(0, 4);
  return (
    <div className="overflow-hidden rounded-[20px] bg-surface">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 px-4 py-3 text-left text-[14px] leading-none font-medium">
        Changes <span className="font-normal text-fg-3">{files.length}</span>
        <span className="flex-1" />
        <Icon name="chevronRight" size={15} className="text-fg-4" />
      </button>
      {shown.map((f) => (
        <div key={f.path} className="flex items-center gap-2.5 border-t border-line px-4 py-2.5 font-mono text-[12.5px] leading-[1.3]">
          {/* rtl keeps the end of a long path, the file name, in view. */}
          <span className="min-w-0 flex-1 truncate text-left [direction:rtl]">{f.path}</span>
          <span className="font-sans">
            <MoDiff add={f.add} del={f.del} />
          </span>
        </div>
      ))}
    </div>
  );
}

function NowLine({ now, meta }: { now: NowDoing; meta?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-surface px-3.5 py-3">
      <StatusDot status="running" size={9} />
      <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.35]">
        {now.verb} {now.target && <span className="font-mono text-[13px]">{now.target}</span>}
      </span>
      {meta && <span className="shrink-0 text-[12px] text-fg-3 tabular-nums">{meta}</span>}
    </div>
  );
}

function Plan({ plan }: { plan: PlanView }) {
  return (
    <div className="flex flex-col gap-[9px] rounded-[20px] bg-surface px-4 py-3">
      <div className="flex text-[13px] leading-none font-medium">
        Plan
        <span className="flex-1" />
        <span className="font-normal text-fg-3 tabular-nums">
          {plan.done}/{plan.todos.length}
        </span>
      </div>
      {plan.todos.map((p, i) => {
        const st = p.status === 'completed' ? 'done' : p.status === 'in_progress' ? 'running' : 'idle';
        return (
          <div key={i} className={`flex items-center gap-2.5 text-[14px] leading-[1.35] ${st === 'running' ? 'text-fg' : 'text-fg-3'}`}>
            <span className="grid w-3 place-items-center">
              <StatusDot status={st} size={8} />
            </span>
            {(st === 'running' && p.activeForm) || p.content}
          </div>
        );
      })}
    </div>
  );
}

/** The threads a Conductor turn delegated, each opening its thread, with Needs you's answer under one that waits. */
function Delegation({ kids }: { kids: Thread[] }) {
  const shell = useShell();
  const { needsYou, channel } = useApp();
  const now = useNow(60_000);
  const waiting = new Map((needsYou?.items ?? []).map((i) => [i.thread.id, i]));
  return (
    <div className="flex flex-col gap-0.5 rounded-[20px] bg-surface px-2 pt-3 pb-2">
      <div className="flex items-center gap-2 px-2 pb-1.5 text-[13px] leading-none font-medium">
        <Icon name="delegate" size={15} />
        Delegated {plural(kids.length, 'task')}
      </div>
      {kids.map((k) => {
        const item = waiting.get(k.id);
        const card = item && item.blockers.length ? needsCard(item, channel(k.channel_id), harnessLabel, now) : null;
        return (
          <div key={k.id} className="flex flex-col rounded-2xl bg-elev shadow-[var(--shadow-card)]">
            <button type="button" onClick={() => shell.open(href.thread(k.id))} className="flex items-center gap-2.5 px-3 py-2.5 text-left">
              <MoAvatar role={k.role} channel={k.channel_id} channelIcon={channel(k.channel_id)?.icon} size={32} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] leading-[1.3]">{k.title || 'Untitled'}</span>
                <span className="truncate text-[12px] leading-[1.3] text-fg-3">{[k.role, k.task_id, `#${channel(k.channel_id)?.name ?? k.channel_id}`].filter(Boolean).join(' · ')}</span>
              </span>
              <StatusPill status={card?.glyph === 'needs' ? 'needs' : k.status} />
            </button>
            {card && (
              <div className="px-3 pb-3 pl-[54px]">
                <NeedsActions card={card} size="md" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Report({ role, taskId, text }: { role?: string | null; taskId?: string | null; text: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[20px] bg-surface p-3.5">
      <div className="flex items-center gap-2 text-[13px] leading-none font-medium">
        <MoAvatar role={role} size={26} />
        Report from {role || 'the crew'}
        <span className="flex-1" />
        {taskId && <span className="font-mono text-[11.5px] font-normal text-fg-3">{taskId}</span>}
      </div>
      <MoProse text={text} />
    </div>
  );
}

/** Messages waiting to reach the agent: queued for after this turn, or held after a restart. */
function Pending({ thread, items, onPending }: { thread: Thread; items: PendingMsg[]; onPending: (p: PendingMsg[]) => void }) {
  const shell = useShell();
  const [busy, setBusy] = useState<string | null>(null);
  const call = async (key: string, route: 'resume' | 'discard', ids: string[]) => {
    setBusy(key);
    try {
      const res = await api.post<{ pending?: PendingMsg[] }>(`/threads/${encodeURIComponent(thread.id)}/requests/${route}`, { ids });
      if (res.pending) onPending(res.pending);
    } catch (e) {
      shell.toast(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {items.map((m) => (
        <div key={m.uuid} className="flex flex-col items-end gap-1.5 opacity-75">
          <span className="text-[12px] leading-[1.3] text-fg-3">{parkedLabel(m) ?? (m.state === 'held' ? 'Queued for after this turn' : 'Sent, waiting for the agent')}</span>
          <div className="max-w-[86%] rounded-[20px] border border-dashed border-line-strong px-3.5 py-2.5 text-[15px] leading-[1.45] break-words whitespace-pre-wrap">{m.text}</div>
          {(m.delivery === 'uncertain' || (m.delivery && isOmnis(m))) && (
            <div className="flex gap-2">
              {m.delivery === 'uncertain' && (
                <Button size="sm" variant="secondary" icon="send" busy={busy === `again:${m.uuid}`} disabled={!!busy} onClick={() => void call(`again:${m.uuid}`, 'resume', [m.uuid])}>
                  Send again
                </Button>
              )}
              {isOmnis(m) && (
                <Button size="sm" variant="ghost" icon="trash" busy={busy === `discard:${m.uuid}`} disabled={!!busy} onClick={() => void call(`discard:${m.uuid}`, 'discard', [m.uuid])}>
                  Discard
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function MenuSheet({ thread, prLabel, onClose }: { thread: Thread; prLabel: string | null; onClose: () => void }) {
  const shell = useShell();
  const { setPinned, setDone, reloadChannels } = useApp();
  const { applyThread, blocked, handoff, setHandoff } = useThread();
  const targets = useHandoffTargets(thread, blocked, handoff);
  // Set while the sheet lists the Macs the thread can go to.
  const [handingOff, setHandingOff] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [grokBusy, setGrokBusy] = useState(false);
  const [grokError, setGrokError] = useState('');
  const grokLock = useRef(false);
  const go = (to: string) => {
    onClose();
    shell.open(to);
  };
  const pin = async () => {
    onClose();
    try {
      applyThread(await setPinned(thread, !thread.pinned_at), true);
      shell.toast(thread.pinned_at ? 'Unpinned' : 'Pinned to Activity');
    } catch (e) {
      shell.toast(errorText(e));
    }
  };
  const done = async () => {
    onClose();
    try {
      applyThread(await setDone(thread.id, !thread.done_at), true);
      shell.toast(thread.done_at ? 'Back in Needs you' : 'Marked done');
    } catch (e) {
      shell.toast(errorText(e));
    }
  };
  const sendGrok = async () => {
    if (grokLock.current) return;
    grokLock.current = true;
    setGrokBusy(true);
    setGrokError('');
    const result = await sendThreadToGrokBot(thread.id);
    grokLock.current = false;
    setGrokBusy(false);
    if (result.ok) {
      onClose();
      shell.toast('Sent to Grok Bot');
      return;
    }
    setGrokError(result.error);
  };
  const archive = async () => {
    onClose();
    try {
      await api.patch<Thread>(`/threads/${encodeURIComponent(thread.id)}`, { archived: !thread.archived });
      await reloadChannels();
      if (thread.archived) shell.toast('Back in the lists');
      else {
        shell.toast('Archived. Search still finds it.');
        shell.back();
      }
    } catch (e) {
      shell.toast(errorText(e));
    }
  };
  const sendTo = async (to: { id: string; name: string }) => {
    setSending(to.id);
    try {
      const a = await handOff(thread.id, to.id);
      applyThread(a.thread, true);
      setHandoff(a.handoff);
      onClose();
      shell.toast(`Handing off to ${to.name}`);
    } catch (e) {
      setSending(null);
      shell.toast(errorText(e));
    }
  };
  if (handingOff && targets.state === 'ready') {
    return (
      <MoSheet onClose={onClose} label="Hand off to">
        <div className="px-5 pt-2.5 pb-0.5 text-[15px] leading-[1.3] font-medium">Hand off to</div>
        <p className="px-5 pb-2.5 text-[12.5px] leading-[1.4] text-fg-3">The turn stops here and keeps running on the Mac you pick.</p>
        <div className="flex flex-col gap-2.5 px-3">
          <MoGroup>
            {deviceRows(targets.devices).map((d, i, all) => (
              <MoListRow
                key={d.id}
                icon={sending === d.id ? <Loader size={14} /> : <StatusDot status={d.dot} size={9} className="mx-[4.5px]" />}
                label={d.name}
                sub={d.label}
                chevron={false}
                disabled={!d.pickable || !!sending}
                onClick={() => void sendTo(d)}
                last={i === all.length - 1}
              />
            ))}
          </MoGroup>
        </div>
      </MoSheet>
    );
  }
  return (
    <MoSheet onClose={onClose} label="Thread options">
      <div className="truncate px-5 pt-2.5 pb-2 text-[15px] leading-[1.3] font-medium">{thread.title || 'Untitled'}</div>
      <div className="flex flex-col gap-2.5 px-3">
        <MoGroup>
          {thread.branch && <MoListRow icon="diff" label="Changes" sub={prLabel ?? `On ${thread.branch}`} onClick={() => go(href.threadView(thread.id, prLabel ? 'pr' : 'changes'))} />}
          <MoListRow icon="browser" label="Browser" sub="Watch only" onClick={() => go(href.threadView(thread.id, 'browser'))} />
          <MoListRow icon="terminal" label="Terminal" sub="Read only" onClick={() => go(href.threadView(thread.id, 'terminal'))} />
          <MoListRow icon="play" label="Actions" sub="Preview, checks, tests" onClick={() => go(href.threadView(thread.id, 'actions'))} />
          <MoListRow icon="info" label="Details" sub="Harness, model, session" onClick={() => go(href.threadView(thread.id, 'details'))} last />
        </MoGroup>
        <MoGroup>
          {targets.state === 'ready' && <MoListRow icon="share" label="Hand off to…" sub="Keep it running on another Mac" onClick={() => setHandingOff(true)} />}
          <MoListRow icon="pin" label={thread.pinned_at ? 'Unpin from Activity' : 'Pin to Activity'} chevron={false} onClick={() => void pin()} />
          {(thread.done_at || canMarkDone(thread.status)) && (
            <MoListRow icon="check" label={thread.done_at ? 'Mark as not done' : 'Mark as done'} chevron={false} onClick={() => void done()} />
          )}
          <MoListRow
            icon={grokBusy ? <Loader size={18} /> : 'external'}
            label="Send to Grok Bot"
            sub={grokBusy ? 'Sending' : "This thread's text"}
            chevron={false}
            disabled={grokBusy}
            onClick={() => void sendGrok()}
          />
          <MoListRow icon="archive" label={thread.archived ? 'Restore thread' : 'Archive thread'} chevron={false} onClick={() => void archive()} last />
        </MoGroup>
        {grokError && <ErrorNote>{grokError}</ErrorNote>}
      </div>
    </MoSheet>
  );
}

/** A worktree thread's changes since its base, again whenever a turn starts or ends. */
function useBranchChanges(thread: Thread | null, busy: boolean) {
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

/** The thread: the outcome first, steps folded behind a row, one secondary surface at a time from the menu. */
export function ThreadScreen() {
  const shell = useShell();
  const s = useThread();
  const { thread, children, events, files, queued, setQueued, applyThread, slotBusy, interrupt, interrupting, notFound, error, actionError, load, ready, handoff, setHandoff } = s;
  const { needsYou, channel } = useApp();
  const now = useNow(30_000);
  const [menu, setMenu] = useState(false);
  const view = useMemo(() => (thread ? threadView({ events, thread, artifacts: files, children }) : null), [events, thread, files, children]);
  const changes = useBranchChanges(thread, slotBusy);
  const pr = useThreadPR(thread, slotBusy, true);
  // Outcome first: open on the newest turn, its prompt at the top, and again when a new turn starts.
  const scroll = useRef<HTMLDivElement>(null);
  const newest = useRef<HTMLDivElement>(null);
  const turns = view?.turns.length ?? 0;
  useEffect(() => {
    const el = scroll.current;
    if (el && newest.current && ready) el.scrollTop = newest.current.offsetTop - el.offsetTop - 8;
  }, [ready, turns]);

  if (notFound || (!thread && error)) {
    return (
      <>
        <MoHeader onBack={shell.back} title="Thread" />
        {notFound ? <MoEmpty>This thread was deleted, or the link is wrong.</MoEmpty> : <ErrorNote className="mx-4" onRetry={() => void load(true)}>{error}</ErrorNote>}
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
  const steps = (t: TurnView) => shell.open(href.threadView(thread.id, 'steps', t.key));
  const theirs = conductor ? 'the Conductor' : thread.role ? `the ${thread.role}` : 'the agent';

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
  if (slotBusy) chips.push({ label: interrupting ? 'Stopping' : 'Stop', icon: 'stop', onClick: () => void interrupt(), disabled: interrupting });
  if (report) chips.push({ label: 'Open report', icon: 'file', onClick: () => viewer(report) });
  if (pr?.pr) chips.push({ label: `Review #${pr.pr.number}`, icon: 'pr', diff: [pr.pr.additions, pr.pr.deletions], onClick: () => shell.open(href.threadView(thread.id, 'pr')) });
  else if (changes?.files.length) {
    chips.push({ label: slotBusy ? 'Changes so far' : 'Review changes', icon: 'diff', diff: [changes.add, changes.del], onClick: () => shell.open(href.threadView(thread.id, 'changes')) });
    if (!slotBusy) chips.push({ label: 'Open PR', icon: 'pr', onClick: () => void openPR() });
  }
  if (!slotBusy && !conductor) chips.push({ label: 'Ask the Conductor', icon: 'delegate', onClick: () => shell.sheet({ name: 'new' }) });

  const sub = conductor ? `Conductor · ${plural(crew.length, 'crew thread')}` : [`#${ch?.name ?? thread.channel_id}`, thread.role, harnessLabel(thread.harness)].filter(Boolean).join(' · ');
  // A Conductor thread needs Ben while any thread it delegated does.
  const kidIds = new Set(crew.map((c) => c.id));
  const needs = card?.glyph === 'needs' || (conductor && !!needsYou?.items.some((i) => kidIds.has(i.thread.id) && reasonOf(i).glyph === 'needs'));
  const sinceStart = (t: TurnView) => shortTime(t.at || thread.created_at, now);

  const turnBody = (t: TurnView, last: boolean): ReactNode => {
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
        {delegated}
        {t.artifacts.map((a) => (
          <ArtifactCard key={a.id} a={a} sub={`#${ch?.name ?? thread.channel_id} · ${shortTime(a.updated_at, now)}`} onOpen={() => viewer(a)} />
        ))}
        {last && changes && changes.files.length > 0 && <ChangesCard files={changes.files} onOpen={() => shell.open(href.threadView(thread.id, pr?.pr ? 'pr' : 'changes'))} />}
        {t.steps > 0 && <StepsRow t={t} onClick={() => steps(t)} />}
      </>
    );
  };

  return (
    <>
      <MoHeader
        onBack={shell.back}
        title={thread.title || 'Untitled'}
        sub={sub}
        right={
          <>
            <StatusPill status={view.asking || needs ? 'needs' : thread.status} label={view.asking ? ASKING_LABEL : needs ? 'Needs you' : undefined} />
            <MoRound icon="more" label="Thread options" onClick={() => setMenu(true)} />
          </>
        }
      />
      <div ref={scroll} className="mo-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-2 pb-4">
        {view.turns.map((t, i) => {
          const last = i === view.turns.length - 1;
          return (
            <div key={t.key} ref={last ? newest : undefined} className="flex flex-col gap-4">
              {t.prompts.map((p, k) => (
                <MoBubble key={k} caption={i === 0 && k === 0 && thread.parent_id ? `Delegated by the Conductor${thread.task_id ? ` · ${thread.task_id}` : ''}` : k > 0 ? 'Sent while it ran' : undefined}>
                  {p.text}
                  {p.attachments?.length ? <span className="text-fg-3"> · {plural(p.attachments.length, 'file')}</span> : null}
                </MoBubble>
              ))}
              {t.reports.map((r, k) => (
                <Report key={k} role={r.role} taskId={r.task_id} text={r.text} />
              ))}
              {t.questions.map((q) => (
                <QuestionCard key={q.id} threadId={thread.id} q={q} touch />
              ))}
              {turnBody(t, last)}
              {t.switches.map((it) => (
                <SwitchLine key={it.key} it={it} running={thread.status === 'running'} />
              ))}
            </div>
          );
        })}
        <HandoffCard
          thread={thread}
          handoff={handoff}
          mobile
          onChanged={(a) => {
            applyThread(a.thread, true);
            setHandoff(a.handoff);
          }}
        />
        {!view.turns.length && <MoEmpty>{thread.setup ? 'Preparing the worktree.' : 'Nothing here yet.'}</MoEmpty>}
        {thread.setup && <BranchingFrom thread={thread} />}
        {/* A question's card above is where Ben answers it. */}
        {card && card.kind !== 'question' && <NeedsCardView card={card} inThread onRecovered={(r) => {
              applyThread(r.thread, true);
              setQueued(r.pending);
            }} />}
        {queued.length > 0 && <Pending thread={thread} items={queued} onPending={setQueued} />}
        {actionError && <ErrorNote>{actionError}</ErrorNote>}
      </div>
      <MoComposer
        thread={thread}
        chips={chips}
        placeholder={(steers) => (conductor ? 'Reply to the Conductor' : !slotBusy ? 'Follow up' : steers ? `Steer ${theirs}` : 'Queue for after this turn')}
        onSent={(t) => applyThread(t, true)}
        onSwitched={(t) => applyThread(t)}
      />
      {menu && <MenuSheet thread={thread} prLabel={pr?.pr ? `PR #${pr.pr.number} · ${plural(changes?.files.length ?? 0, 'file')}` : null} onClose={() => setMenu(false)} />}
    </>
  );
}
