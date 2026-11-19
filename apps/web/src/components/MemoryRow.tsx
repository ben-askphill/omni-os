import { useState } from 'react';
import { MEMORY_MAX, type Memory } from '@omni/shared/memory.ts';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText } from '../api.ts';
import { href } from '../router.ts';
import { Button, Chip, ErrorNote, InlineConfirm } from './ui.tsx';

/** An agent's lesson a role kept without waiting (`memory_writes: auto`): approved in the same write that made it. */
const keptAtOnce = (m: Memory) => m.proposed_by === 'agent' && m.status === 'approved' && m.approved_at === m.created_at;

/**
 * One memory fact: a channel's learning or a crew role's lesson (packages/shared/memory.ts). Waiting ones offer
 * Approve, Edit and Dismiss; approved ones Edit and Delete. `scope` names where a role's lesson applies. Each change is
 * the user's own (PATCH and DELETE /api/memory/:id, which refuse agent threads).
 */
export function MemoryRow({ fact, onChanged, scope }: { fact: Memory; onChanged: () => void; scope?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const waiting = fact.status === 'proposed';

  const save = async (body: { text?: string; approve?: boolean }) => {
    setBusy(true);
    setProblem(null);
    try {
      await api.patch(`/memory/${encodeURIComponent(fact.id)}`, body);
      setEditing(false);
      onChanged();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    await api.del(`/memory/${encodeURIComponent(fact.id)}`);
    onChanged();
  };

  return (
    <li className="rounded-[14px] bg-surface-2 px-3.5 py-2.5">
      {editing ? (
        <textarea
          className="field min-h-[60px] w-full resize-y"
          value={text}
          maxLength={MEMORY_MAX}
          onChange={(e) => setText(e.target.value)}
          aria-label={fact.role ? 'Edit lesson' : 'Edit learning'}
          autoFocus
        />
      ) : (
        <p className="text-[13px] leading-relaxed text-fg">{fact.text}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-fg-3">
        {waiting ? (
          <Chip tone="needs">Waiting for you</Chip>
        ) : (
          <span>
            {keptAtOnce(fact) ? 'Kept at once' : 'Approved'} {relTime(fact.approved_at ?? fact.created_at)}
          </span>
        )}
        {scope && <Chip tone="outline">{scope}</Chip>}
        {fact.source_thread_id && (
          <a href={href.thread(fact.source_thread_id)} className="text-fg-2 hover:text-fg">
            From a thread
          </a>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setText(fact.text))} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" busy={busy} disabled={!text.trim()} onClick={() => void save({ text })}>
                {waiting ? 'Save and approve' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              {waiting && (
                <Button size="sm" variant="primary" busy={busy} onClick={() => void save({ approve: true })}>
                  Approve
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <InlineConfirm label={waiting ? 'Dismiss' : 'Delete'} confirmLabel={waiting ? 'Dismiss' : 'Delete'} busyLabel="Removing" onConfirm={remove} />
            </>
          )}
        </span>
      </div>
      {problem && <ErrorNote className="mt-2">{problem}</ErrorNote>}
    </li>
  );
}
