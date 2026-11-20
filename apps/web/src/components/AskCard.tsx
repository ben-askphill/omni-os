// Ask from a thread on the web (packages/shared/ask.ts, apps/server/ask.ts): the Ask chip over a composer once a
// message starts with `@<role>`, the Ask sheet the thread menu opens, and a sent Ask in the transcript, shown with the
// live state of the thread it started and, after "Just show it", the answer on its card.
import { useEffect, useMemo, useState } from 'react';
import { askableRoles, askCaption, askLabel, excerptSize, type AskP, type AskPreview, type AskRole, type AskSent } from '@omni/shared/ask.ts';
import type { ReportP } from '@omni/shared/transcript-fold.ts';
import { api, errorText, useApi, type Thread } from '../api.ts';
import { useCrewRoles } from '../store.tsx';
import { withLive } from '../transcript/delegation.ts';
import { CrewMark, isCrewRole } from './brand.tsx';
import { RemoteMark } from './ConnectAgent.tsx';
import { DelegationCard } from './Delegation.tsx';
import { isImeEnter } from '../ime.ts';
import { Button, ErrorNote, Icon, Label, Modal, ModalFooter, Picker, Segmented, Toggle, type PickerOption } from './ui.tsx';

/** The roles Ben can ask from this thread (askableRoles): never the Conductor, a hidden role or the thread's own. */
export function useAskRoles(thread: Pick<Thread, 'role'>): AskRole[] {
  const crew = useCrewRoles();
  return useMemo(() => askableRoles(crew, thread.role), [crew, thread.role]);
}

/** How an Ask goes: with this thread's excerpt or not, and whether its answer wakes this thread. */
export interface AskOptions {
  excerpt: boolean;
  wake: boolean;
}

export const ASK_DEFAULTS: AskOptions = { excerpt: true, wake: true };

/** Send an Ask. One request id per send, so a retry of a lost answer does not start a second one. */
export const postAsk = (threadId: string, role: string, question: string, o: AskOptions) =>
  api.post<AskSent>(`/threads/${encodeURIComponent(threadId)}/ask`, { role, question, excerpt: o.excerpt, wake: o.wake, request_id: crypto.randomUUID() });

/**
 * What an Ask would carry from this thread, and the two choices: send the excerpt (or not, or none at all when the
 * channel keeps excerpts from remote agents) and wake this thread with the answer or only show it.
 */
function AskOptionsRow({ threadId, role, options, onOptions }: { threadId: string; role: AskRole; options: AskOptions; onOptions: (o: AskOptions) => void }) {
  const preview = useApi<AskPreview>(`/threads/${encodeURIComponent(threadId)}/ask-preview?role=${encodeURIComponent(role.id)}`);
  const [peek, setPeek] = useState(false);
  const ex = preview.data?.excerpt;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-fg-2">
      {ex && !ex.allowed ? (
        <span data-excerpt-off className="text-fg-3">
          {ex.reason}
        </span>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-2">
          <Toggle checked={options.excerpt} onChange={(excerpt) => onOptions({ ...options, excerpt })} label="Send a thread excerpt" />
          <span data-excerpt-size className={options.excerpt ? '' : 'text-fg-3 line-through'}>
            Thread excerpt{ex ? `: ${ex.entries ? excerptSize(ex) : 'nothing to send yet'}` : ''}
          </span>
          {ex?.entries ? (
            <button type="button" onClick={() => setPeek(true)} className="font-medium text-fg underline underline-offset-2">
              Preview
            </button>
          ) : null}
        </span>
      )}
      <Segmented
        size="sm"
        label="When it answers"
        value={options.wake ? 'wake' : 'show'}
        onChange={(v) => onOptions({ ...options, wake: v === 'wake' })}
        options={[
          { id: 'wake', label: 'Wake this thread', title: "The answer goes to this thread's agent, which uses it in its work" },
          { id: 'show', label: 'Just show it', title: 'The answer shows here; the agent reads it with your next message' },
        ]}
      />
      <Modal open={peek} onClose={() => setPeek(false)} title="Thread excerpt" wide>
        <div className="space-y-3 px-6 pb-6">
          <p className="text-[13px] text-fg-2">
            What {role.name} reads with your question{role.remote ? ', on a server outside Omni' : ''}. Secret values read as [masked]; tool calls and files never go.
          </p>
          <pre data-excerpt-text className="scroll-thin max-h-[60vh] overflow-auto rounded-[14px] bg-bg p-3 font-mono text-[11.5px] leading-[1.55] break-words whitespace-pre-wrap text-fg-2">
            {ex?.text}
          </pre>
        </div>
      </Modal>
    </div>
  );
}

/** Over a composer once its message is an Ask: who gets it instead of this thread's agent, and how it goes. */
export function AskChip({ threadId, role, options, onOptions }: { threadId: string; role: AskRole; options: AskOptions; onOptions: (o: AskOptions) => void }) {
  return (
    <div data-ask-chip className="mx-2 mt-2 flex flex-col gap-2 rounded-[16px] bg-bg px-3 py-2.5 shadow-[var(--shadow-card)]">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
        <Icon name="message" size={14} className="text-fg-3" />
        <span className="font-medium text-fg">{askLabel(role)}</span>
        {role.remote && <RemoteMark />}
        <span className="text-fg-3">instead of this thread&apos;s agent</span>
      </div>
      <AskOptionsRow threadId={threadId} role={role} options={options} onOptions={onOptions} />
    </div>
  );
}

/** Ask… from the thread menu: pick a role, write the question, choose what goes along and what the answer does. */
export function AskSheet({ thread, open, onClose, onSent }: { thread: Thread; open: boolean; onClose: () => void; onSent?: (s: AskSent) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Ask an agent">
      {open && <AskForm thread={thread} onClose={onClose} onSent={onSent} />}
    </Modal>
  );
}

function AskForm({ thread, onClose, onSent }: { thread: Thread; onClose: () => void; onSent?: (s: AskSent) => void }) {
  const roles = useAskRoles(thread);
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const role = roles.find((r) => r.id === roleId) ?? roles[0];
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<AskOptions>(ASK_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picks: PickerOption<string>[] = roles.map((r) => ({ value: r.id, label: r.name, sub: r.remote ? 'Remote agent' : r.id }));
  const send = async () => {
    if (!role || !question.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSent?.(await postAsk(thread.id, role.id, question.trim(), options));
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!role) return <p className="px-6 pb-6 text-[13px] text-fg-2">No agent can be asked from here. Add one in Settings &gt; Agents, or connect a harness in Settings &gt; Models.</p>;
  return (
    <>
      <div className="space-y-4 px-6 pb-5">
        <p className="text-[13px] leading-5 text-fg-2">Omni starts a thread as the agent with your question. Its answer comes back here as a report.</p>
        <div>
          <Label htmlFor="ask-role">Agent</Label>
          <div className="flex items-center gap-2">
            <Picker id="ask-role" size="field" label="Agent" value={role.id} options={picks} onChange={setRoleId} />
            {role.remote && <RemoteMark />}
          </div>
        </div>
        <div>
          <Label htmlFor="ask-question">Question</Label>
          <textarea
            id="ask-question"
            data-autofocus
            className="field min-h-[96px] w-full resize-y"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isImeEnter(e)) void send();
            }}
            placeholder={`What should ${role.name} look into?`}
          />
        </div>
        <AskOptionsRow threadId={thread.id} role={role} options={options} onOptions={setOptions} />
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" busy={busy} disabled={!question.trim()} onClick={() => void send()}>
          {askLabel(role)}
        </Button>
      </ModalFooter>
    </>
  );
}

/**
 * A sent Ask in the transcript: Ben's question with what went along, then the thread it started on a delegation card
 * with its live state, and its answer there once it showed without a turn ("Just show it").
 */
export function AskItem({ p, byId, reports, answer }: { p: AskP; byId: Map<string, Thread>; reports?: Map<string, string>; answer?: ReportP }) {
  const branch = withLive({ id: p.thread_id, title: p.title, role: p.role, channel: p.channel, harness: p.harness, task_id: null, status: 'queued' }, byId);
  return (
    <div data-ask className="flex flex-col gap-3">
      <div className="flex flex-col items-end">
        <div className="mb-1 text-right text-[11.5px] text-fg-3">{askCaption(p)}</div>
        <div className="max-w-[92%] rounded-[22px] rounded-tr-lg bg-bubble px-4 py-2.5 text-[14.5px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%]">{p.question}</div>
      </div>
      <DelegationCard
        mark={isCrewRole(p.role) ? <CrewMark role={p.role} size={16} className="text-fg" /> : <Icon name="message" size={15} className="text-fg" />}
        label={
          <>
            Asked {p.name}
            {p.remote && <RemoteMark host={p.harness_name} />}
          </>
        }
        branches={[branch]}
        reports={reports}
        answers={answer ? { [p.thread_id]: answer } : undefined}
      />
    </div>
  );
}

const OPEN_EVENT = 'omni:ask-from-thread';

/** Open the Ask sheet for a thread, as the thread menu's Ask a crew role… does. */
export function openAsk(thread: Thread) {
  window.dispatchEvent(new CustomEvent<Thread>(OPEN_EVENT, { detail: thread }));
}

/** Mounted once in the desktop layout, so the thread menu opens the Ask sheet over any page. */
export function AskSheetHost() {
  const [thread, setThread] = useState<Thread | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setThread((e as CustomEvent<Thread>).detail);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  return thread ? <AskSheet key={thread.id} thread={thread} open onClose={() => setThread(null)} /> : null;
}
