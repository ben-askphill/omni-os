// A group thread's member list on the phone (ADR 0019): the same list the desktop header's avatars open in a popover
// (components/thread/Members.tsx), in a bottom sheet. The thread menu's Add an agent… opens it with the agent list out.
import type { Thread } from '../api.ts';
import { Facepile, MemberList } from '../components/thread/Members.tsx';
import { MoSheet } from './parts.tsx';
import { useThread } from './shell.tsx';

export function MemberSheet({ thread, adding, onClose }: { thread: Thread; adding?: boolean; onClose: () => void }) {
  const { applyThread } = useThread();
  return (
    <MoSheet onClose={onClose} label={adding ? 'Add an agent' : 'Agents in this thread'}>
      <div className="px-3 pb-2">
        <MemberList thread={thread} adding={adding} size={32} onChanged={(t) => applyThread(t, true)} />
      </div>
    </MoSheet>
  );
}

/** The header's avatars on the phone, in place of the status pill: each shows its agent's state in its eyes (ADR 0021). */
export function MemberButton({ thread, onOpen }: { thread: Thread; onOpen: () => void }) {
  const members = thread.members ?? [];
  const running = members.filter((m) => m.state === 'working').map((m) => m.name);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${members.length} agents in this thread${running.length ? `, ${running.join(' and ')} working` : ''}`}
      className="press flex h-11 shrink-0 items-center gap-1 rounded-full pr-2 pl-1 text-[12px] font-medium text-fg-2"
      data-member-avatars
    >
      <Facepile members={members} size={24} max={2} count={false} />
      {members.length}
    </button>
  );
}
