import { useEffect, useRef, useState } from 'react';
import { api, errorText, type Artifact, type PendingMsg, type Thread } from '../api.ts';
import { harnessLabel } from '../components/brand.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { useSending } from '../sending.ts';
import { ArtifactThumb } from '../pages/Artifacts.tsx';
import { ContextChips, hasContext } from '../message-context/ContextChips.tsx';
import { Attachments } from '../components/Transcript.tsx';
import { Button, Icon, StatusDot, StatusPill } from '../components/ui.tsx';
import { duration, plural } from '../format.ts';
import { isOmnis, parkedLabel } from '../requests.ts';
import { useApp, useNow } from '../store.tsx';
import { href } from '../router.ts';
import { needsCard } from './activity.ts';
import { NeedsActions } from './NeedsCard.tsx';
import { MoAvatar, MoDiff, MoStripes } from './parts.tsx';
import { useShell } from './shell.tsx';
import type { NowDoing, PlanView, TurnView } from './thread-view.ts';

const DRAWN = new Set(['html', 'image', 'svg']);
const ext = (name: string) => (name.includes('.') ? name.split('.').pop()! : 'file');
const ENDED: Record<string, [string, string]> = { done: ['Done', 'Done in'], failed: ['Failed', 'Failed after'], stopped: ['Stopped', 'Stopped after'] };

export function MoProse({ text }: { text: string }) {
  return <Markdown text={text} className="text-[15px] leading-[1.6] text-pretty" />;
}

export function Outcome({ t, harness }: { t: TurnView; harness: string }) {
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
export function Clamped({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen((o) => !o)} className={`m-0 text-left font-mono text-[12.5px] leading-[1.5] break-words whitespace-pre-wrap text-fg-2 ${open ? '' : 'line-clamp-4'}`}>
      {text}
    </button>
  );
}

export function StepsRow({ t, live, onClick }: { t: TurnView; live?: boolean; onClick: () => void }) {
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
        <Icon name="chevronRight" size={15} className="text-fg-4" />
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

export function NowLine({ now, meta }: { now: NowDoing; meta?: string }) {
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

export function Plan({ plan }: { plan: PlanView }) {
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
export function Delegation({ kids }: { kids: Thread[] }) {
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

export function Report({ role, taskId, text, dropped, undelivered }: { role?: string | null; taskId?: string | null; text: string; dropped?: boolean; undelivered?: string }) {
  return (
    <div className={`flex flex-col gap-2.5 rounded-[20px] bg-surface p-3.5 ${dropped ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 text-[13px] leading-none font-medium">
        <MoAvatar role={role} size={26} />
        Report from {role || 'the crew'}
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
          <span className="text-[12px] leading-[1.3] text-fg-3">{parkedLabel(m, !!thread.resume_blocked) ?? (m.state === 'held' ? 'Queued for after this turn' : 'Sent, waiting for the agent')}</span>
          {m.attachments?.length ? <Attachments threadId={thread.id} items={m.attachments} /> : null}
          <ContextChips records={m.context} align="end" className="w-full max-w-[86%]" />
          {(m.text || !hasContext(m.context)) && (
            <div className="max-w-[86%] rounded-[20px] border border-dashed border-line-strong px-3.5 py-2.5 text-[15px] leading-[1.45] break-words whitespace-pre-wrap">{m.text}</div>
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
      ))}
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
            {m.files.length ? <Attachments threadId={threadId} items={m.files.map((f) => f.attachment)} href={(a) => urls.get(a.name) ?? ''} /> : null}
            {m.text && <div className="max-w-[86%] rounded-[20px] border border-dashed border-line-strong px-3.5 py-2.5 text-[15px] leading-[1.45] break-words whitespace-pre-wrap">{m.text}</div>}
          </div>
        );
      })}
    </>
  );
}
