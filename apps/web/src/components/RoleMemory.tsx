import { useMemo, useState } from 'react';
import { MEMORY_MAX, type Memory } from '@omni/shared/memory.ts';
import { memoryScope } from '@omni/shared/crew-settings.ts';
import { api, errorText, useApi, type CrewRole } from '../api.ts';
import { useApp, useFeed } from '../store.tsx';
import { MemoryRow } from './MemoryRow.tsx';
import { Button, ErrorNote, Loading, Picker, type PickerOption } from './ui.tsx';

// A crew role's memory (GET /api/crew/<id>/memory, apps/server/memory-api.ts; crew plan S6): lessons every later
// thread of the role gets in its prompt, in every channel or in one. Its threads propose them with remember, and none
// applies until you approve it, unless the role keeps its lessons at once. Fresh when one changes here or elsewhere.
// It sits inside the role editor's form, so adding a lesson submits nothing: Enter and Add lesson save only the lesson.

type RoleMemoryList = { memories: Memory[]; waiting: number };

export function RoleMemory({ role }: { role: Pick<CrewRole, 'id' | 'name' | 'memory' | 'memoryWrites'> }) {
  const { channels } = useApp();
  const res = useApi<RoleMemoryList>(`/crew/${encodeURIComponent(role.id)}/memory`);
  const { data, error, reload } = res;
  useFeed((e) => {
    if ((e.type === 'memory' && e.role === role.id) || e.type === 'reconnect') reload();
  });
  const [draft, setDraft] = useState('');
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const channelOptions = useMemo<PickerOption<string>[]>(
    () => [
      { value: '', label: 'Every channel', sub: 'Every thread of this role', avatar: false, icon: 'globe' },
      ...channels.filter((c) => !c.archived && c.id !== 'conductor').map((c) => ({ value: c.id, label: c.name, sub: `Only its threads in #${c.id}`, channelIcon: c.icon, avatarBg: c.avatar_bg })),
    ],
    [channels],
  );

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/crew/${encodeURIComponent(role.id)}/memory`, { text, channel: channel || null });
      setDraft('');
      reload();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const mode = role.memory ?? 'read-write';
  const note =
    mode === 'off'
      ? 'Memory is off for this role: its threads get none of these lessons. Turn it on under Memory in the form.'
      : mode === 'read'
        ? 'Its threads get the lessons you approved. Only you add them.'
        : role.memoryWrites === 'auto'
          ? 'Its threads get the lessons below, and the ones they propose apply at once, each naming its thread. A thread under an automation, or one proposing for every channel, still waits for you.'
          : 'Its threads get the lessons you approved, and propose new ones with remember. Nothing they propose applies until you approve it.';

  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-[18px] text-fg-3">{note}</p>
      {data.memories.length === 0 && <p className="text-[12.5px] text-fg-3">No lessons yet. Add one, or let its threads propose them.</p>}
      <ul className="space-y-2" aria-label={`${role.name}'s memory`}>
        {data.memories.map((m) => (
          <MemoryRow key={m.id} fact={m} onChanged={reload} scope={memoryScope(m)} />
        ))}
      </ul>
      <div className="space-y-2">
        <input
          className="field w-full"
          value={draft}
          maxLength={MEMORY_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void add();
          }}
          placeholder="Add a lesson, like: Run the repo's own check script before you report"
          aria-label="New lesson"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Picker label="Applies in" value={channel} onChange={setChannel} options={channelOptions} searchable />
          <Button size="sm" busy={busy} disabled={!draft.trim()} className="ml-auto" onClick={() => void add()}>
            Add lesson
          </Button>
        </div>
      </div>
      {problem && <ErrorNote>{problem}</ErrorNote>}
    </div>
  );
}
