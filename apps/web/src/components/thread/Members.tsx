// A group thread's agents on the desktop web (ADR 0019): the members' avatars at the right of the thread header, which
// open the member list in a popover, with each member's run and Remove, and Add an agent. Each avatar shows its
// member's state in its eyes, or a photo's or icon's ring (ADR 0021, D8); the header has no Working label. The quick-actions card's Lead and Members rows, and the Add an agent dialog
// the thread menu opens, live here too. The phone draws the same list as a sheet (mobile/MemberSheet.tsx).
import { useEffect, useRef, useState } from 'react';
import type { FacePlacement } from '@omni/shared/agent-avatar.ts';
import type { ThreadMember } from '@omni/shared/members.ts';
import { pickedRun, threadChoice, threadRunLabels, type RunPick } from '@omni/shared/thread-run.ts';
import { api, errorText, useApi, type HarnessWithRunning, type Thread } from '../../api.ts';
import { pickerAccounts, useAccounts } from '../../accounts.ts';
import { useThreadAgents } from '../../thread-agents.ts';
import { AgentAvatar, useAgent } from '../AgentAvatar.tsx';
import { ModelPicker } from '../ModelPicker.tsx';
import { Button, ErrorNote, Icon, Modal, ModalFooter, StatusDot } from '../ui.tsx';
import { useAnchoredPopover } from '../ui/use-anchored-popover.ts';
import { isRemoteAgentHarness } from '@omni/shared/remote-agent.ts';

const STATE_LABEL: Record<ThreadMember['state'], string> = {
  needs: 'Waiting on you',
  failed: 'Failed',
  working: 'Working',
  done: 'Idle',
  stopped: 'Stopped',
  idle: 'Not run yet',
};
const STATE_MARK = { needs: 'question', failed: 'failed', working: 'working', done: 'done', stopped: 'stopped', idle: 'idle' } as const;

/**
 * One agent's avatar, showing its member state. `placement`: in focus in the thread header and the member list, in a
 * row in the quick card's Members row.
 */
export function MemberFace({ member, size = 22, placement = 'focus' }: { member: Pick<ThreadMember, 'agent' | 'name' | 'state'>; size?: number; placement?: FacePlacement }) {
  const agent = useAgent(member.agent) ?? { id: member.agent, name: member.name };
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full" data-state={member.state}>
      <AgentAvatar agent={{ ...agent, name: member.name }} size={size} shows={{ member: member.state }} placement={placement} />
    </span>
  );
}

const LOUD: Partial<Record<ThreadMember['state'], number>> = { needs: 2, working: 1 };

/** Overlapping avatars, `max` at most: the agents that wait on Ben or work come first, so their state always shows. */
export function Facepile({ members, size = 22, max = 3, count = true, placement }: { members: readonly ThreadMember[]; size?: number; max?: number; count?: boolean; placement?: FacePlacement }) {
  const shown = [...members].sort((a, b) => (LOUD[b.state] ?? 0) - (LOUD[a.state] ?? 0)).slice(0, max);
  const more = count ? members.length - shown.length : 0;
  return (
    <span className="flex items-center">
      {shown.map((m, i) => (
        <span key={m.agent} className="relative rounded-full" style={{ marginLeft: i ? -size * 0.3 : 0, zIndex: shown.length - i }}>
          <MemberFace member={m} size={size} placement={placement} />
        </span>
      ))}
      {more > 0 && <span className="ml-1 text-[11.5px] font-medium text-fg-3">+{more}</span>}
    </span>
  );
}

/** The members' avatars at the right of the thread header (Q54). They open the member list. */
export function MemberAvatars({ thread, onChanged }: { thread: Thread; onChanged?: (t: Thread) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const pop = useAnchoredPopover({ open, onDismiss: () => setOpen(false), wrap, trigger: btn, panel: card, align: 'right' });
  const members = thread.members;
  if (!members?.length) return null;
  const running = members.filter((m) => m.state === 'working').map((m) => m.name);
  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        ref={btn}
        type="button"
        {...pop.triggerProps}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${members.length} agents in this thread${running.length ? `, ${running.join(' and ')} working` : ''}`}
        onClick={() => setOpen(!pop.clickCloses())}
        className={`press flex h-8 items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-[12px] font-medium text-fg-2 ${open ? 'bg-surface-2' : 'hov'}`}
        data-member-avatars
      >
        <Facepile members={members} count={false} />
        {members.length}
      </button>
      {open && (
        <div ref={card} role="dialog" aria-label="Agents in this thread" {...pop.panelProps} className={`pik-card w-[min(22rem,calc(100vw-32px))] p-2 ${pop.inlineClass}`}>
          <MemberList thread={thread} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

/** The member list itself: the popover's on desktop, the sheet's on the phone. */
export function MemberList({ thread, onChanged, size = 28, adding = false }: { thread: Thread; onChanged?: (t: Thread) => void; size?: number; adding?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const members = thread.members ?? [];
  const call = async (fn: () => Promise<Thread>) => {
    setError(null);
    try {
      // Not `onChanged?.(await fn())`: with no onChanged that skips the request itself.
      const t = await fn();
      onChanged?.(t);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="flex flex-col" data-member-list>
      <div className="flex items-baseline justify-between px-2 pt-1">
        <span className="caption">In this thread</span>
        <span className="text-[11.5px] text-fg-3">@ an agent to send it a message</span>
      </div>
      <div className="px-2">
        {members.map((m) => (
          <MemberRow key={m.agent} thread={thread} member={m} size={size} onRemove={() => call(() => api.del<Thread>(`/threads/${encodeURIComponent(thread.id)}/members/${encodeURIComponent(m.agent)}`))} onError={setError} onChanged={onChanged} />
        ))}
      </div>
      <AddAgent thread={thread} open={adding} onAdded={(t) => onChanged?.(t)} onError={setError} />
      {error && <ErrorNote className="mx-2 mt-2">{error}</ErrorNote>}
    </div>
  );
}

function MemberRow({
  thread,
  member,
  size,
  onRemove,
  onError,
  onChanged,
}: {
  thread: Thread;
  member: ThreadMember;
  size: number;
  onRemove: () => Promise<void>;
  onError: (why: string | null) => void;
  onChanged?: (t: Thread) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div data-member={member.agent}>
      <div className="flex min-w-0 items-center gap-3 py-2">
        <MemberFace member={member} size={size} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
            <span className="truncate">{member.name}</span>
            {member.lead && <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] font-medium text-fg-3">Lead</span>}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3">
            <StatusDot mark={STATE_MARK[member.state]} size={7} />
            <span className="truncate">{STATE_LABEL[member.state]}</span>
          </span>
        </span>
        {!member.lead && (
          <Button size="sm" variant="ghost" aria-label={`Remove ${member.name}`} onClick={() => setConfirming(true)} disabled={confirming}>
            Remove
          </Button>
        )}
      </div>
      {/* The lead's run is the thread's own, switched from the composer's model pill (Q51). */}
      {/* A remote agent's run is its server, not a run to switch (ADR 0020). */}
      {!member.lead && !isRemoteAgentHarness(member.harness) && <MemberRun thread={thread} member={member} onError={onError} onChanged={onChanged} />}
      {confirming && (
        <div className="mb-2 rounded-[16px] bg-bg p-3 shadow-[var(--shadow-card)]">
          <p className="text-[12.5px] leading-[1.45] text-fg-2">
            Remove {member.name} from this thread? Its session closes{member.state === 'working' ? ' once its turn finishes' : ''}. Its replies stay in the thread.
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="needs"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                await onRemove();
                setBusy(false);
                setConfirming(false);
              }}
            >
              Remove {member.name}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A member's run, which Ben switches here (Q15). A new member starts on its agent's defaults, then the channel's, then Auto. */
function MemberRun({ thread, member, onError, onChanged }: { thread: Thread; member: ThreadMember; onError: (why: string | null) => void; onChanged?: (t: Thread) => void }) {
  const { data: harnesses, reload } = useApi<HarnessWithRunning[]>('/harnesses');
  const accounts = useAccounts();
  const [switching, setSwitching] = useState(false);
  if (!harnesses) return null;
  const shown = { harness: member.harness, model: member.model, effort: member.effort };
  const labels = threadRunLabels(shown, harnesses);
  const pick = async (p: RunPick) => {
    const run = pickedRun(shown, harnesses, p);
    if (!run || switching) return;
    setSwitching(true);
    onError(null);
    try {
      const t = await api.post<Thread>(`/threads/${encodeURIComponent(thread.id)}/members/${encodeURIComponent(member.agent)}/run`, run);
      onChanged?.(t);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setSwitching(false);
    }
  };
  return (
    <div className="-mt-1 mb-1.5 flex items-center gap-2 pl-10">
      <ModelPicker
        harnesses={harnesses}
        onOpen={() => {
          reload();
          accounts.reload();
        }}
        accounts={pickerAccounts(accounts.data, 'here')}
        offerAuto={false}
        label={labels.model}
        value={threadChoice(shown, harnesses)}
        disabled={switching}
        onChange={(c) => void pick(c)}
        effort={{ value: member.effort, onChange: (effort) => void pick({ effort }) }}
      />
    </div>
  );
}

/** Add an agent: seats it with a joined line and no turn (Q8). Any agent but the Conductor (Q10). */
function AddAgent({ thread, open: openFirst, onAdded, onError }: { thread: Thread; open: boolean; onAdded: (t: Thread) => void; onError: (why: string | null) => void }) {
  const [open, setOpen] = useState(openFirst);
  const { others } = useThreadAgents(thread);
  if (!others.length) return null;
  return (
    <div className="border-t border-[var(--line)] px-2 pt-2 mt-1">
      {!open ? (
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setOpen(true)}>
          Add an agent
        </Button>
      ) : (
        <AgentChoices thread={thread} onAdded={onAdded} onError={onError} onCancel={() => setOpen(false)} />
      )}
    </div>
  );
}

function AgentChoices({ thread, onAdded, onError, onCancel }: { thread: Thread; onAdded: (t: Thread) => void; onError: (why: string | null) => void; onCancel?: () => void }) {
  const { others } = useThreadAgents(thread);
  const [busy, setBusy] = useState<string | null>(null);
  const add = async (agent: string) => {
    setBusy(agent);
    onError(null);
    try {
      onAdded(await api.post<Thread>(`/threads/${encodeURIComponent(thread.id)}/members`, { agent }));
      onCancel?.();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-0.5" role="list" aria-label="Agents to add">
      {others.map((a) => (
        <AgentChoice key={a.id} id={a.id} name={a.name} busy={busy === a.id} onPick={() => void add(a.id)} />
      ))}
      {onCancel && (
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function AgentChoice({ id, name, busy, onPick }: { id: string; name: string; busy: boolean; onPick: () => void }) {
  const agent = useAgent(id) ?? { id, name };
  return (
    <button type="button" role="listitem" disabled={busy} onClick={onPick} className="press hov flex min-h-10 items-center gap-2.5 rounded-2xl px-2 text-left text-[13px] font-medium disabled:opacity-50">
      <AgentAvatar agent={agent} size={24} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <Icon name={busy ? 'clock' : 'plus'} size={13} className="text-fg-3" />
    </button>
  );
}

/** The quick-actions card's Lead and Members rows (Q54): who leads, and who else is seated, with their avatars. */
export function MembersLine({ thread }: { thread: Thread }) {
  const others = (thread.members ?? []).filter((m) => !m.lead);
  if (!others.length) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Facepile members={others} size={18} placement="row" />
      <span className="min-w-0 truncate">{others.map((m) => m.name).join(', ')}</span>
    </span>
  );
}

// ---------- Add an agent from the thread menu ----------

const OPEN_EVENT = 'omni:add-agent';

/** Open Add an agent for a thread, as the thread menu's Add an agent… does. */
export function openAddAgent(thread: Thread) {
  window.dispatchEvent(new CustomEvent<Thread>(OPEN_EVENT, { detail: thread }));
}

/** Mounted once in the desktop layout, so the thread menu opens Add an agent over any page. */
export function AddAgentHost() {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      setError(null);
      setThread((e as CustomEvent<Thread>).detail);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  if (!thread) return null;
  return (
    <Modal open onClose={() => setThread(null)} title="Add an agent">
      <div className="space-y-3 px-6 pb-5">
        <p className="text-[13px] leading-5 text-fg-2">The agent joins this thread and stays until you remove it. It answers when a message @mentions it, starting from a catch-up of the thread.</p>
        <AgentChoices thread={thread} onAdded={() => setThread(null)} onError={setError} />
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={() => setThread(null)}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
