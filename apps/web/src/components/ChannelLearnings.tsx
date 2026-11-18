import { useState } from 'react';
import { MEMORY_MAX, type Memory } from '@omni/shared/memory.ts';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi } from '../api.ts';
import { href } from '../router.ts';
import { useFeed } from '../store.tsx';
import { Button, Chip, ErrorNote, InlineConfirm, Loading } from './ui.tsx';

// A channel's Recent learnings (GET /api/memory?channel=<id>, apps/server/memory-api.ts): lessons every later thread in
// this channel gets in its prompt, and no other channel's does. Agents propose them; nothing applies until the user
// approves. Fresh when one changes here or on another machine.

type Learnings = { learnings: Memory[]; waiting: number };

export function useLearnings(channel: string) {
  const res = useApi<Learnings>(`/memory?channel=${encodeURIComponent(channel)}`);
  useFeed((e) => {
    if ((e.type === 'memory' && e.channel_id === channel) || e.type === 'reconnect') res.reload();
  });
  return res;
}

export function ChannelLearnings({ channel }: { channel: string }) {
  const { data, error, reload } = useLearnings(channel);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/memory', { channel, text });
      setDraft('');
      reload();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-3">
      {data.learnings.length === 0 && <p className="text-[12.5px] text-fg-3">None yet. The Conductor proposes lessons from corrections you make here; you can add your own.</p>}
      <ul className="space-y-2">
        {data.learnings.map((m) => (
          <LearningRow key={m.id} fact={m} onChanged={reload} />
        ))}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="field min-w-0 flex-1 basis-56"
          value={draft}
          maxLength={MEMORY_MAX}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a lesson, like: Quote prices without VAT for this client"
          aria-label="New learning"
        />
        <Button type="submit" size="sm" busy={busy} disabled={!draft.trim()}>
          Add
        </Button>
      </form>
      {problem && <ErrorNote>{problem}</ErrorNote>}
    </div>
  );
}

function LearningRow({ fact, onChanged }: { fact: Memory; onChanged: () => void }) {
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
          aria-label="Edit learning"
          autoFocus
        />
      ) : (
        <p className="text-[13px] leading-relaxed text-fg">{fact.text}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-fg-3">
        {waiting ? <Chip tone="needs">Waiting for you</Chip> : <span>Approved {relTime(fact.approved_at ?? fact.created_at)}</span>}
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
