import { useState } from 'react';
import { MEMORY_MAX, type Memory } from '@omni/shared/memory.ts';
import { api, errorText, useApi } from '../api.ts';
import { useFeed } from '../store.tsx';
import { MemoryRow } from './MemoryRow.tsx';
import { Button, ErrorNote, Loading } from './ui.tsx';

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
          <MemoryRow key={m.id} fact={m} onChanged={reload} />
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
