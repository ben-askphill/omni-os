import { useEffect, useRef, useState } from 'react';
import { setupWait } from '@omni/shared/setup-wait.ts';
import { api, errorText, type Artifact, type PendingMsg, type Thread } from '../api.ts';
import { harnessLabel } from '../components/brand.tsx';
import { branchShows } from '../components/Delegation.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { useSending } from '../sending.ts';
import { ArtifactThumb } from '../components/ArtifactThumb.tsx';
import { ContextChips, hasContext } from '../message-context/ContextChips.tsx';
import { MentionText } from '../message-context/MentionText.tsx';
import { sentContext } from '@omni/shared/message-context-machine.ts';
import { SentTo } from '../message-context/agent-mention.tsx';
import { Attachments } from '../components/Transcript.tsx';
import { Button, Icon, Loader, StatusDot, StatusPill } from '../components/ui.tsx';
import { duration, plural } from '../format.ts';
import { isOmnis, parkedLabel } from '../requests.ts';
import { useApp, useNeedOf, useNow } from '../store.tsx';
import { href } from '../router.ts';
import { needsCard } from './activity.ts';
import { NeedsActions } from './NeedsCard.tsx';
import { MoAvatar, MoDiff, MoStripes } from './parts.tsx';
import { RemoteMark } from '../components/ConnectAgent.tsx';
import { useShell } from './shell.tsx';
import { forwardedLabel, isForwarded, useSyncTrouble } from '../forwarded.ts';
import type { NowDoing, TurnView as TurnOf } from '@omni/shared/thread-view.ts';
import { actionsLabel, stepsHeader, stepsLabel, type StepsView } from '@omni/shared/steps.ts';
import { threadMark } from '@omni/shared/status.ts';
import type { ReportP } from '@omni/shared/transcript-fold.ts';
import { Folded } from '../components/Folded.tsx';
import { ConnectorMark, NowWithConnector } from '../components/ConnectorMark.tsx';
import { StepRail } from '../components/thread/StepRail.tsx';
import { progressReach } from '@omni/shared/progress-panel.ts';
import { connectorsUsed } from '@omni/shared/connectors.ts';

/** The phone's turn, carrying the web's own artifact and thread rows. */
export type TurnView = TurnOf<Artifact, Thread>;

const DRAWN = new Set(['html', 'image', 'svg']);
const ext = (name: string) => (name.includes('.') ? name.split('.').pop()! : 'file');
const ENDED: Record<string, [string, string]> = { done: ['Done', 'Done in'], failed: ['Failed', 'Failed after'], stopped: ['Stopped', 'Stopped after'] };

/** `event`: the answer's row, for the find bar (thread-find-dom.ts). */
export function MoProse({ text, event }: { text: string; event?: number | null }) {
  return (
    <div data-find-event={event ?? undefined}>
      <Markdown text={text} className="text-[15px] leading-[1.6] text-pretty" />
    </div>
  );
}

/** `limit`: the thread's limit line (limits.ts `limitLabel`) on the turn the usage limit stopped. */
/** `harness`: named at the end, for a turn no agent wrote. An agent's turn shows it on its author line, behind Show technical details. */
export function Outcome({ t, harness, limit }: { t: TurnView; harness: string | null; limit?: string | null }) {
  const took = duration(t.result?.duration_ms);
  const [word, after] = ENDED[t.status] ?? ['Ended', 'Ended after'];
  return (
    <div className="flex items-center gap-2 text-[12.5px] leading-[1.3] text-fg-3 tabular-nums">
      <StatusDot status={limit ? 'limited' : t.status} size={8} />
      {[limit ?? (took ? `${after} ${took}` : word), t.progress ? stepsLabel(t.progress.steps.length) : null, harness && harnessLabel(harness)].filter(Boolean).join(' · ')}
    </div>
  );
}

/** A long error, four lines until tapped. */
export function Clamped({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen((o) => !o)} className={`m-0 text-left font-mono text-[12.5px] leading-[1.5] break-words whitespace-pre-wrap text-fg-2 ${open ? '' : 'line-clamp-4'}`}>
      {text}
    </button>
  );
}

/**
 * A turn's plain steps (@omni/shared/steps.ts), as desktop shows them: open while the turn runs, a line with Show
 * steps once it ends. The calls stay one tap away: "N actions" opens the Actions screen.
 */
export function MoSteps({ v, failed, onActions }: { v: StepsView; failed: number; onActions: () => void }) {
  const [shown, setShown] = useState(false);
  const open = v.live || shown;
  const ended = v.steps.some((s) => s.state === 'failed') ? 'failed' : v.steps.every((s) => s.state === 'done') ? 'done' : 'settled';
  const reach = progressReach(v.steps);
  return (
    <div className="flex flex-col rounded-[20px] bg-surface">
      {v.live ? (
        <div className="flex items-center px-4 pt-3 pb-1 text-[13px] leading-none font-medium">
          {stepsHeader(v)}
          <span className="flex-1" />
          {v.source !== 'phases' && (
            <span className="font-normal text-fg-3 tabular-nums">
              {v.done}/{v.steps.length}
            </span>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setShown((o) => !o)} aria-expanded={open} className="mo-press flex min-h-11 items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] leading-none text-fg-2">
          <StatusDot status={ended} size={8} />
          <span className="flex-1 tabular-nums">{stepsHeader(v)}</span>
          <span className="text-[12.5px] text-fg-3">{open ? 'Hide' : 'Show steps'}</span>
          <Icon name="chevronRight" size={15} className={`text-fg-3 transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-90' : ''}`} />
        </button>
      )}
      {open && (
        <ol className="flex flex-col px-4 pt-[3.5px]">
          {v.steps.map((s, i) => {
            const on = s.state === 'active' || s.state === 'needs';
            return (
              <li key={s.key} data-state={s.state} className="flex items-start gap-2.5">
                {/* The rail as on the Progress card; the row's top padding (4.5px) plus half of a 14px line at 1.35. */}
                <StepRail state={s.state} index={i} count={v.steps.length} reach={reach} mid={14} finished={ended === 'done'} className="w-3" />
                <span className="min-w-0 flex-1 py-[4.5px]">
                  <span className={`block text-[14px] leading-[1.35] ${on ? 'text-fg' : 'text-fg-3'}`}>{s.title}</span>
                  {s.now && (
                    <span className="block text-[12.5px] leading-[1.35] text-fg-3">
                      <NowWithConnector now={s.now} connector={s.connector} />
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {open && v.actions > 0 && (
        <button type="button" onClick={onActions} className="mo-press mt-1 flex h-11 items-center gap-2.5 border-t border-line px-4 text-left text-[13px] leading-none text-fg-3">
          <span className="flex-1 tabular-nums">
            {actionsLabel(v.actions)}
            {failed > 0 && (
              <>
                <span> · </span>
                <span className="inline-flex items-center gap-[5px] text-fg-2">
                  <StatusDot status="failed" size={7} />
                  {failed} failed
                </span>
              </>
            )}
          </span>
          <Icon name="chevronRight" size={15} />
        </button>
      )}
      {open && !v.actions && <div className="h-2" />}
    </div>
  );
}

export function ArtifactCard({ a, sub, onOpen }: { a: Artifact; sub: string; onOpen: () => void }) {
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
        <Icon name="chevronRight" size={15} className="text-fg-3" />
      </div>
    </button>
  );
}

export function ChangesCard({ files, onOpen }: { files: { path: string; add: number; del: number }[]; onOpen: () => void }) {
  const shown = files.slice(0, 4);
  return (
    <div className="overflow-hidden rounded-[20px] bg-surface">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 px-4 py-3 text-left text-[14px] leading-none font-medium">
        Changes <span className="font-normal text-fg-3">{files.length}</span>
        <span className="flex-1" />
        <Icon name="chevronRight" size={15} className="text-fg-3" />
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

/**
 * The outside connectors a turn used, one row each, as Claude's apps show them in a reply: the app's tile, "Working on
 * it" while one of its calls runs and "Used Granola" after. A tap opens the turn's actions, where each call opens.
 */
export function MoConnectors({ t, onOpen }: { t: TurnView; onOpen: () => void }) {
  const calls = t.items.flatMap((it) => (it.type === 'tools' ? it.calls : []));
  const used = connectorsUsed(calls);
  if (!used.length) return null;
  const live = t.status === 'running';
  return (
    <div className="flex flex-col">
      {used.map((u) => {
        const busy = live && u.running > 0;
        return (
          <button key={u.connector.id} type="button" data-connector-row={u.connector.id} onClick={onOpen} className="mo-press flex min-h-11 items-center gap-2.5 rounded-2xl px-1 text-left text-[14px] leading-none">
            <ConnectorMark connector={u.connector} size={26} />
            <span className="shrink-0 font-medium text-fg-2">{busy ? 'Working on it' : `Used ${u.connector.name}`}</span>
            <span className="min-w-0 truncate text-[13px] text-fg-3">{plural(u.calls, 'call')}</span>
            <Icon name="chevronRight" size={14} className="shrink-0 text-fg-3" />
            <span className="flex-1" />
            {busy ? <Loader size={12} className="shrink-0 text-fg-3" /> : u.failed > 0 ? <StatusDot status="failed" size={7} /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function NowLine({ now, meta }: { now: NowDoing; meta?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-surface px-3.5 py-3">
      {now.connector ? <ConnectorMark connector={now.connector} size={18} /> : <StatusDot status="running" size={9} />}
      <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.35]">
        {now.verb} {now.target && <span className="font-mono text-[13px]">{now.target}</span>}
      </span>
      {meta && <span className="shrink-0 text-[12px] text-fg-3 tabular-nums">{meta}</span>}
    </div>
  );
}

/** A delegated thread's state, a question it asked through its job included. */
function KidPill({ k }: { k: Thread }) {
  return <StatusPill mark={threadMark(k, { need: useNeedOf(k.id) })} />;
}

/** The threads a Conductor turn delegated, each opening its thread, with Needs you's answer under one that waits. */
/** `answers`: reports shown in place (ReportP `shown`), by the thread that sent them, each under its row. */
/** `asked`: who the turn's Asks went to, when every row is an Ask's thread: the card names them, as the desktop's does. */
export function Delegation({ kids, answers, asked }: { kids: Thread[]; answers?: Record<string, ReportP>; asked?: { name: string; remote: string | null } }) {
  const shell = useShell();
  const { needsYou, channel } = useApp();
  const now = useNow(60_000);
  const waiting = new Map((needsYou?.items ?? []).map((i) => [i.thread.id, i]));
  return (
    <div className="flex flex-col gap-0.5 rounded-[20px] bg-surface px-2 pt-3 pb-2">
      <div className="flex items-center gap-2 px-2 pb-1.5 text-[13px] leading-none font-medium">
        <Icon name={asked ? 'message' : 'delegate'} size={15} />
        {asked ? `Asked ${asked.name}` : `Delegated ${plural(kids.length, 'task')}`}
        {asked?.remote != null && <RemoteMark host={asked.remote || undefined} />}
      </div>
      {kids.map((k) => {
        const item = waiting.get(k.id);
        const card = item && item.blockers.length ? needsCard(item, channel(k.channel_id), harnessLabel, now) : null;
        return (
          <div key={k.id} className="flex flex-col rounded-2xl bg-elev shadow-[var(--shadow-card)]">
            <button type="button" onClick={() => shell.open(href.thread(k.id))} className="flex items-center gap-2.5 px-3 py-2.5 text-left">
              <MoAvatar role={k.role} channel={k.channel_id} channelIcon={channel(k.channel_id)?.icon} avatarBg={channel(k.channel_id)?.avatar_bg} shows={branchShows(k.status)} size={32} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] leading-[1.3]">{k.title || 'Untitled'}</span>
                <span className="truncate text-[12px] leading-[1.3] text-fg-3">{[k.role, k.task_id, `#${channel(k.channel_id)?.name ?? k.channel_id}`].filter(Boolean).join(' · ')}</span>
              </span>
              <KidPill k={k} />
            </button>
            {card && (
              <div className="px-3 pb-3 pl-[54px]">
                <NeedsActions card={card} size="md" />
              </div>
            )}
            {answers?.[k.id] && k.status !== 'running' && k.status !== 'queued' && (
              <div className="px-3 pb-3 text-[15px]">
                <Folded>
                  <MoProse text={answers[k.id].text || '(no reply)'} />
                </Folded>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** `remote`: the server the child ran on, outside Omni, when it did. */
export function Report({ role, taskId, text, dropped, undelivered, remote }: { role?: string | null; taskId?: string | null; text: string; dropped?: boolean; undelivered?: string; remote?: string }) {
  return (
    <div className={`flex flex-col gap-2.5 rounded-[20px] bg-surface p-3.5 ${dropped ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 text-[13px] leading-none font-medium">
        <MoAvatar role={role} size={26} />
        Report from {role || 'the crew'}
        {remote !== undefined && <RemoteMark host={remote || undefined} />}
        {dropped && (
          <span className="text-[11.5px] font-normal text-fg-3" title={undelivered ?? 'The run ended before the agent read this report'}>
            Not delivered
          </span>
        )}
        <span className="flex-1" />
        {taskId && <span className="font-mono text-[11.5px] font-normal text-fg-3">{taskId}</span>}
      </div>
      <MoProse text={text} />
    </div>
  );
}

/** Messages waiting to reach the agent: queued for after this turn, or held after a restart. */
export function Pending({ thread, items, onPending }: { thread: Thread; items: PendingMsg[]; onPending: (p: PendingMsg[]) => void }) {
  const shell = useShell();
  const [busy, setBusy] = useState<string | null>(null);
  const trouble = useSyncTrouble(items.some(isForwarded));
  const call = async (key: string, route: 'resume' | 'discard', ids: string[]) => {
    setBusy(key);
    try {
      const res = await api.post<{ pending?: PendingMsg[] }>(`/threads/${encodeURIComponent(thread.id)}/requests/${route}`, { ids });
      if (res.pending) onPending(res.pending);
    } catch (e) {
      shell.toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {items.map((m) => {
        const sent = sentContext(m.text, m.context);
        return (
          <div key={m.uuid} className="flex flex-col items-end gap-1.5 opacity-75">
            <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[12px] leading-[1.3] text-fg-3">
              <span>{isForwarded(m) ? forwardedLabel(m, trouble) : (setupWait(thread.setup)?.label ?? parkedLabel(m, !!thread.resume_blocked) ?? (m.state === 'held' ? 'Queued for after this turn' : 'Sent, waiting for the agent'))}</span>
              <SentTo agents={sent.to} />
            </span>
            {m.attachments?.length ? <Attachments threadId={thread.id} items={m.attachments} lazy={false} /> : null}
            <ContextChips records={sent.chips} align="end" className="w-full max-w-[86%]" />
            {(m.text || !hasContext(m.context)) && (
              <div className="max-w-[86%] rounded-[20px] border border-dashed border-line-strong px-3.5 py-2.5 text-[15px] leading-[1.45] break-words whitespace-pre-wrap">
                <MentionText text={m.text} records={m.context} />
              </div>
            )}
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
        );
      })}
    </>
  );
}

/** Ben's replies still on their way to the server, with the files he picked, until it lists them (sending.ts). */
export function Sending({ threadId, pending }: { threadId: string; pending: PendingMsg[] }) {
  const items = useSending(threadId, pending);
  // Ben just sent it: bring it into view, wherever he had scrolled to.
  const last = useRef<HTMLDivElement>(null);
  const newest = items[items.length - 1]?.request_id;
  useEffect(() => {
    const el = last.current;
    if (!newest || !el) return;
    const show = () => el.scrollIntoView({ block: 'end' });
    show();
    // Its pictures load after it lands, and grow it.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(show);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [newest]);
  return (
    <>
      {items.map((m) => {
        const urls = new Map(m.files.map((f) => [f.attachment.name, f.url]));
        return (
          <div key={m.request_id} ref={m.request_id === newest ? last : undefined} className="flex flex-col items-end gap-1.5 opacity-75">
            <span className="text-[12px] leading-[1.3] text-fg-3">Sending</span>
            {m.files.length ? <Attachments threadId={threadId} items={m.files.map((f) => f.attachment)} href={(a) => urls.get(a.name) ?? ''} lazy={false} /> : null}
            {m.text && <div className="max-w-[86%] rounded-[20px] border border-dashed border-line-strong px-3.5 py-2.5 text-[15px] leading-[1.45] break-words whitespace-pre-wrap">{m.text}</div>}
          </div>
        );
      })}
    </>
  );
}
