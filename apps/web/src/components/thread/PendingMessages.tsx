import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Attachments } from './Attachments.tsx';
import { api, ApiError, errorText, type Attachment, type PendingMsg, type Thread } from '../../api.ts';
import { bytes, plural } from '../../format.ts';
import { Button, copyText, Icon, IconButton } from '../ui.tsx';
import { isOmnis, isParked, parkedHeading, parkedLabel, parkedOf, requestIdFor } from '../../requests.ts';
import { useSending } from '../../sending.ts';
import { canMove, canSteerNow, editBody, editFailed, isEditable, movedOrder, openEdit, reconcileEdits, STALE_NOTE, type EditDraft } from '../../pending-edits.ts';
import { ContextChips, hasContext } from '../../message-context/ContextChips.tsx';

/** A message that waits for the thread's worktree (SetupCard). */
const SETUP_LABEL = 'Sends once the worktree is ready';

function pendingLabel(m: PendingMsg, lead: boolean) {
  if (m.state === 'waiting') return 'Waiting for a free slot';
  if (m.state === 'held') return 'Queued, runs after this turn';
  if (lead) return 'Sent, starting now';
  return m.mode === 'interrupt' ? 'Interrupting, runs next' : 'Steering, delivered at its next step';
}

/**
 * Messages (and crew reports) the agent has not read yet; shown under the live output.
 * `starting`: no turn is under way yet, so the first sent message starts one instead of steering it.
 * Queued and held messages Ben sent can be edited, moved and removed until the runner sends them, and a held one
 * can be steered into the running turn now instead of waiting for it to end
 * (apps/web/src/pending-edits.ts). Messages a restart left waiting on Ben come last, with Resume and Send again
 * (`ParkedMessages`). An edit whose message went first stays below, with Ben's text.
 */
export function QueuedMessages({
  items,
  starting = false,
  threadId,
  onPending,
  setup = null,
  canSteer = true,
}: {
  items: PendingMsg[];
  starting?: boolean;
  /** The thread's worktree is not ready: what waits sends once it is, so Retry (SetupCard) stands in for Resume. */
  setup?: Thread['setup'];
  /** Needed for the actions on Ben's own messages. */
  threadId?: string;
  /** The pending list an action answered with, before the stream brings it. */
  onPending?: (items: PendingMsg[]) => void;
  /** The harness takes messages mid-turn, so a held message offers Steer now. */
  canSteer?: boolean;
}) {
  const [drafts, setDrafts] = useState<EditDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every new pending list: an open edit whose message was sent meanwhile turns stale and keeps its text.
  useEffect(() => setDrafts((d) => reconcileEdits(d, items)), [items]);
  const stale = drafts.filter((d) => d.status === 'stale');
  if (!items.length && !stale.length) return null;
  const live = items.filter((m) => !isParked(m));
  const parked = items.filter(isParked);
  const lead = starting ? live.find((m) => m.state === 'sent') : undefined;
  const path = (rest: string) => `/threads/${encodeURIComponent(threadId ?? '')}/requests${rest}`;
  const update = (uuid: string, fn: (d: EditDraft) => EditDraft | null) =>
    setDrafts((all) => all.flatMap((d) => (d.uuid === uuid ? (fn(d) ?? []) : [d])));

  const act = async (key: string, call: () => Promise<{ pending?: PendingMsg[] }>) => {
    setBusy(key);
    setError(null);
    try {
      const res = await call();
      if (res.pending) onPending?.(res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const save = async (d: EditDraft) => {
    if (!d.prompt.trim() && !hasContext(items.find((m) => m.uuid === d.uuid)?.context)) return;
    update(d.uuid, (x) => ({ ...x, status: 'saving', error: undefined }));
    try {
      const res = await api.send<{ pending?: PendingMsg[] }>(path(`/${encodeURIComponent(d.uuid)}`), editBody(d), d.added, 'PATCH');
      update(d.uuid, () => null);
      if (res.pending) onPending?.(res.pending);
    } catch (e) {
      update(d.uuid, (x) => editFailed(x, e instanceof ApiError ? e.status : 0, errorText(e)));
    }
  };
  const actions = {
    busy,
    drafts,
    items,
    edit: (m: PendingMsg) => setDrafts((all) => [...all.filter((d) => d.uuid !== m.uuid), openEdit(m)]),
    change: (uuid: string, fn: (d: EditDraft) => EditDraft) => update(uuid, fn),
    close: (uuid: string) => update(uuid, () => null),
    save,
    remove: (m: PendingMsg) => void act(`remove:${m.uuid}`, () => api.post(path('/cancel'), { ids: [m.uuid] })),
    steer: canSteer ? (m: PendingMsg) => void act(`steer:${m.uuid}`, () => api.post(path('/steer'), { ids: [m.uuid] })) : undefined,
    move: (m: PendingMsg, step: -1 | 1) => {
      const ids = movedOrder(items, m.uuid, step);
      if (ids) void act(`move:${m.uuid}`, () => api.post(path('/reorder'), { ids }));
    },
  };
  const ownRow = (m: PendingMsg, label: string, icon: 'send' | 'clock' | 'alert', extra?: ReactNode) => {
    const d = drafts.find((x) => x.uuid === m.uuid && x.status !== 'stale');
    if (d) return <EditBox key={m.uuid} draft={d} label={label} actions={actions} />;
    return (
      <PendingBubble key={m.uuid} m={m} label={label} icon={icon} threadId={threadId}>
        <PendingActions m={m} actions={actions}>
          {extra}
        </PendingActions>
      </PendingBubble>
    );
  };

  return (
    <div className="mt-5 flex flex-col gap-3">
      {live.map((m, i) =>
        m.kind === 'crew_report' ? (
          <div key={m.uuid ?? i} className="flex items-center gap-1.5 text-[12px] text-fg-3">
            <Icon name={m.state === 'sent' ? 'send' : 'clock'} size={12} />
            <span className="truncate">
              {pendingLabel(m, m === lead)}
              {m.role ? ` from ${m.role}` : ''}
              {m.task_id ? ` · ${m.task_id}` : ''}
            </span>
          </div>
        ) : threadId && isEditable(m) ? (
          ownRow(m, setup ? SETUP_LABEL : pendingLabel(m, false), 'clock')
        ) : (
          <PendingBubble key={m.uuid ?? i} m={m} label={setup ? SETUP_LABEL : pendingLabel(m, m === lead)} icon={m.state === 'sent' ? 'send' : 'clock'} threadId={threadId} />
        ),
      )}
      {parked.length > 0 && threadId && <ParkedMessages threadId={threadId} items={parked} onPending={onPending} row={ownRow} busy={busy} setup={setup} />}
      {error && <div className="text-right text-[12px] text-needs">{error}</div>}
      {threadId && stale.map((d) => <StaleEdit key={d.uuid} threadId={threadId} draft={d} onClose={() => actions.close(d.uuid)} />)}
    </div>
  );
}

interface PendingActionsApi {
  busy: string | null;
  drafts: EditDraft[];
  items: PendingMsg[];
  edit: (m: PendingMsg) => void;
  change: (uuid: string, fn: (d: EditDraft) => EditDraft) => void;
  close: (uuid: string) => void;
  save: (d: EditDraft) => Promise<void>;
  remove: (m: PendingMsg) => void;
  move: (m: PendingMsg, step: -1 | 1) => void;
  /** Absent when the harness cannot steer. */
  steer?: (m: PendingMsg) => void;
}

/** Up, down, Edit and Remove under one of Ben's unsent messages, Steer now under a held one, plus whatever else the row offers. */
function PendingActions({ m, actions: a, children }: { m: PendingMsg; actions: PendingActionsApi; children?: ReactNode }) {
  const off = !!a.busy;
  return (
    <div className="mt-1 flex flex-wrap items-center justify-end gap-0.5">
      {children}
      <IconButton icon="arrowUp" label="Move up" size={14} className="h-7 w-7" disabled={off || !canMove(a.items, m.uuid, -1)} onClick={() => a.move(m, -1)} />
      <IconButton icon="arrowDown" label="Move down" size={14} className="h-7 w-7" disabled={off || !canMove(a.items, m.uuid, 1)} onClick={() => a.move(m, 1)} />
      <Button size="sm" variant="ghost" icon="pencil" disabled={off} onClick={() => a.edit(m)}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" icon="trash" busy={a.busy === `remove:${m.uuid}`} disabled={off} onClick={() => a.remove(m)}>
        Remove
      </Button>
      {a.steer && canSteerNow(m) && (
        <Button size="sm" variant="ghost" icon="send" busy={a.busy === `steer:${m.uuid}`} disabled={off} title="The agent reads it at its next step" onClick={() => a.steer?.(m)}>
          Steer now
        </Button>
      )}
    </div>
  );
}

/** One unsent message being edited, in place of its bubble. The composer's draft is untouched. */
function EditBox({ draft: d, label, actions: a }: { draft: EditDraft; label: string; actions: PendingActionsApi }) {
  const m = a.items.find((x) => x.uuid === d.uuid);
  const kept = (m?.attachments ?? []).filter((f) => d.keep.includes(f.name));
  const saving = d.status === 'saving';
  const empty = !d.prompt.trim() && !hasContext(m?.context);
  const pick = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-end">
      <div className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-fg-3">
        <Icon name="pencil" size={12} /> Editing · {label}
      </div>
      <div className="w-full max-w-[92%] rounded-[22px] rounded-tr-lg border border-line-strong bg-surface px-4 py-3 sm:max-w-[80%]">
        <textarea
          aria-label="Edit queued message"
          autoFocus
          value={d.prompt}
          rows={Math.min(10, Math.max(2, d.prompt.split('\n').length))}
          disabled={saving}
          onChange={(e) => a.change(d.uuid, (x) => ({ ...x, prompt: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void a.save(d);
            } else if (e.key === 'Escape') a.close(d.uuid);
          }}
          className="w-full resize-none bg-transparent text-[14px] leading-[1.55] text-fg outline-none"
        />
        <ContextChips records={m?.context} className="mt-2" />
        {kept.length + d.added.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {kept.map((f) => (
              <FileChip key={`k:${f.name}`} name={f.name} size={f.size} disabled={saving} onRemove={() => a.change(d.uuid, (x) => ({ ...x, keep: x.keep.filter((n) => n !== f.name) }))} />
            ))}
            {d.added.map((f, i) => (
              <FileChip key={`a:${f.name}:${i}`} name={f.name} size={f.size} disabled={saving} onRemove={() => a.change(d.uuid, (x) => ({ ...x, added: x.added.filter((y) => y !== f) }))} />
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <input
            ref={pick}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              a.change(d.uuid, (x) => ({ ...x, added: [...x.added, ...files] }));
            }}
          />
          <IconButton icon="paperclip" label="Attach files" size={15} disabled={saving} onClick={() => pick.current?.click()} />
          <span className="flex-1" />
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => a.close(d.uuid)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" icon="check" busy={saving} disabled={empty} onClick={() => void a.save(d)}>
            Save
          </Button>
        </div>
      </div>
      {d.error && <div className="mt-1 text-right text-[12px] text-needs">{d.error}</div>}
    </div>
  );
}

function FileChip({ name, size, disabled, onRemove }: { name: string; size: number; disabled?: boolean; onRemove: () => void }) {
  return (
    <span className="flex h-8 max-w-[15rem] items-center gap-1.5 rounded-full bg-surface-2 pr-0.5 pl-2.5 text-[12px]">
      <Icon name="file" size={13} className="text-fg-3" />
      <span className="min-w-0 truncate font-medium text-fg-2">{name}</span>
      <span className="font-num text-[10.5px] text-fg-4">{bytes(size)}</span>
      <IconButton icon="x" label={`Remove ${name}`} size={12} className="h-6 w-6" disabled={disabled} onClick={onRemove} />
    </span>
  );
}

/** An edit the server refused because its message was sent first. Ben's text stays until he copies, sends or drops it. */
function StaleEdit({ threadId, draft: d, onClose }: { threadId: string; draft: EditDraft; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // One id for this text, so a retried send is answered as the same message.
  const [requestId] = useState(() => requestIdFor(null, d.uuid).id);
  const sendNew = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.send(`/threads/${encodeURIComponent(threadId)}/messages`, { prompt: d.prompt.trim(), mode: 'queue', request_id: requestId }, d.added);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end" role="status">
      <div className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-needs">
        <Icon name="alert" size={12} /> {d.error ?? STALE_NOTE}
      </div>
      <div className="max-w-[92%] rounded-[22px] rounded-tr-lg border border-line-strong bg-surface-2 px-4 py-2.5 text-[14px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%]">
        {d.prompt}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={copied ? 'check' : 'copy'}
          onClick={() => {
            void copyText(d.prompt);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="secondary" icon="send" busy={busy} disabled={!d.prompt.trim()} onClick={() => void sendNew()}>
          Send as new
        </Button>
        <Button size="sm" variant="ghost" icon="x" disabled={busy} onClick={onClose}>
          Dismiss
        </Button>
      </div>
      {error && <div className="mt-1 text-right text-[12px] text-needs">{error}</div>}
    </div>
  );
}

/** Ben's replies still on their way to the server, shown with the files he picked until it lists them (sending.ts). */
export function SendingMessages({ threadId, pending }: { threadId: string; pending: readonly PendingMsg[] }) {
  const items = useSending(threadId, pending);
  if (!items.length) return null;
  return (
    <div className="mt-5 flex flex-col gap-3">
      {items.map((m) => {
        const urls = new Map(m.files.map((f) => [f.attachment.name, f.url]));
        return (
          <PendingBubble
            key={m.request_id}
            m={{ text: m.text, attachments: m.files.map((f) => f.attachment) }}
            label="Sending"
            icon="send"
            threadId={threadId}
            href={(a) => urls.get(a.name) ?? ''}
          />
        );
      })}
    </div>
  );
}

export function PendingBubble({
  m,
  label,
  icon,
  threadId,
  href,
  children,
}: {
  m: Pick<PendingMsg, 'text' | 'attachments' | 'context'>;
  label: string;
  icon: 'send' | 'clock' | 'alert';
  /** Shows the files themselves, as on a sent message. Without it, only how many. */
  threadId?: string;
  href?: (a: Attachment) => string;
  children?: ReactNode;
}) {
  const files = m.attachments ?? [];
  return (
    <div className="flex flex-col items-end">
      <div className="flex w-full flex-col items-end opacity-70">
        <div className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-fg-3">
          <Icon name={icon} size={12} /> {label}
          {files.length && !threadId ? <span className="text-fg-4">· {plural(files.length, 'file')}</span> : null}
        </div>
        {threadId && files.length ? <Attachments threadId={threadId} items={files} href={href} /> : null}
        <ContextChips records={m.context} align="end" className="mb-1.5 w-full max-w-[92%] sm:max-w-[80%]" />
        {(m.text || !hasContext(m.context)) && (
          <div className="max-w-[92%] rounded-[22px] rounded-tr-lg border border-dashed border-line-strong px-4 py-2.5 text-[14px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%]">
            {m.text}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Messages Omni accepted before it restarted, and crew reports kept for a thread Ben stopped. A recovered one never
 * reached the agent: Resume sends every one in the saved order. An uncertain one may have, so it is only sent again
 * when Ben says so. Editing, moving or removing one never resumes anything. A crew report or a team's go is Omni's,
 * not Ben's: it has Discard (it stays in the transcript, marked not sent) instead of Edit, moves and Remove.
 */
function ParkedMessages({
  threadId,
  items,
  onPending,
  row,
  busy: rowBusy,
  setup,
}: {
  threadId: string;
  items: PendingMsg[];
  onPending?: (items: PendingMsg[]) => void;
  row: (m: PendingMsg, label: string, icon: 'send' | 'clock' | 'alert', extra?: ReactNode) => ReactNode;
  busy: string | null;
  setup?: Thread['setup'];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { recovered } = parkedOf(items);
  const off = !!busy || !!rowBusy;
  const resume = async (key: string, ids?: string[]) => {
    setBusy(key);
    setError(null);
    try {
      const res = await api.post<{ pending?: PendingMsg[] }>(`/threads/${encodeURIComponent(threadId)}/requests/resume`, ids ? { ids } : {});
      if (res.pending) onPending?.(res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const discard = async (uuid: string) => {
    setBusy(`discard:${uuid}`);
    setError(null);
    try {
      const res = await api.post<{ pending?: PendingMsg[] }>(`/threads/${encodeURIComponent(threadId)}/requests/discard`, { ids: [uuid] });
      if (res.pending) onPending?.(res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-fg-3">{setup ? SETUP_LABEL : parkedHeading(items)}</span>
        {recovered.length > 0 && !setup && (
          <Button size="sm" variant="primary" icon="play" busy={busy === 'resume'} disabled={off} onClick={() => void resume('resume')}>
            Resume{recovered.length > 1 ? ` ${recovered.length}` : ''}
          </Button>
        )}
      </div>
      {items.map((m) => {
        const again = m.delivery === 'uncertain' && (
          <Button size="sm" variant="secondary" icon="send" busy={busy === `again:${m.uuid}`} disabled={off} onClick={() => void resume(`again:${m.uuid}`, [m.uuid])}>
            Send again
          </Button>
        );
        const icon = m.delivery === 'uncertain' ? 'alert' : 'clock';
        const label = setup ? 'Waits for the worktree' : parkedLabel(m);
        if (!isOmnis(m)) return row(m, label ?? '', icon, again);
        return (
          <PendingBubble key={m.uuid} m={m} label={label ?? 'Held for Resume'} icon={icon}>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-0.5">
              {again}
              <Button size="sm" variant="ghost" icon="trash" busy={busy === `discard:${m.uuid}`} disabled={off} onClick={() => void discard(m.uuid)}>
                Discard
              </Button>
            </div>
          </PendingBubble>
        );
      })}
      {error && <div className="text-right text-[12px] text-needs">{error}</div>}
    </div>
  );
}
