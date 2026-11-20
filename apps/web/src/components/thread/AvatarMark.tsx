// The avatar mark (ADR 0019, Q35, Q68): while a group thread's agents run or wait on Ben, their avatars are the
// thread's status mark, the one asking first in the Needs you ring with the Needs you diamond on it, then the working
// ones in the Working ring, two at most, else one and a count, and a red dot beside them for an agent that failed. The
// desktop thread lists, Inbox cards and the Overview dashboard draw it in the mark's place; the phone rows say it on
// their second line (MarkLine). Rules in @omni/shared/members.ts.
import { avatarMark, markLine, type MarkFace, type ThreadMember } from '@omni/shared/members.ts';
import { AgentAvatar, useAgent } from '../AgentAvatar.tsx';
import { StatusDot } from '../ui/status.tsx';

type Members = readonly Pick<ThreadMember, 'agent' | 'name' | 'lead' | 'state'>[] | undefined;

/** One face: the Working ring, or the Needs you ring with the diamond on its bottom-left (the next face overlaps the right). */
function Face({ face, size }: { face: MarkFace; size: number }) {
  const agent = useAgent(face.agent) ?? { id: face.agent, name: face.name };
  const badge = Math.max(9, Math.round(size * 0.55));
  return (
    <span className="relative inline-grid shrink-0" data-face={face.ring}>
      <span className={`inline-grid rounded-full ${face.ring === 'needs' ? 'member-ring-needs' : 'member-ring-working'}`}>
        <AgentAvatar agent={{ ...agent, name: face.name }} size={size} />
      </span>
      {face.ring === 'needs' && (
        <span className="absolute grid place-items-center rounded-full bg-bg" style={{ width: badge, height: badge, left: -badge * 0.35, bottom: -badge * 0.35 }}>
          <StatusDot mark="question" size={Math.max(7, badge - 3)} />
        </span>
      )}
    </span>
  );
}

/** The faces and the dot, with what they say as the label. Null while no agent works or waits on Ben. */
export function AvatarMark({ members, size = 16, className = '' }: { members: Members; size?: number; className?: string }) {
  const mark = avatarMark(members);
  if (!mark) return null;
  const said = markLine(members) ?? '';
  return (
    <span role="img" aria-label={said} title={said} data-avatar-mark className={`inline-flex shrink-0 items-center ${className}`}>
      {mark.faces.map((f, i) => (
        <span key={f.agent} className="relative rounded-full" style={{ marginLeft: i ? -size * 0.3 : 0, zIndex: mark.faces.length - i }}>
          <Face face={f} size={size} />
        </span>
      ))}
      {mark.more > 0 && (
        <span className="ml-1 shrink-0 font-num font-semibold text-fg-2 tabular-nums" style={{ fontSize: Math.max(10.5, size * 0.62) }}>
          +{mark.more}
        </span>
      )}
      {mark.failed && <span aria-hidden="true" data-failed-dot className="ml-1 h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--needs)]" />}
    </span>
  );
}

/** The phone row's second line (Q35 pick C): the faces, then who asks and who works in words. Null when none does. */
export function MarkLine({ members, size = 14, className = '' }: { members: Members; size?: number; className?: string }) {
  const said = markLine(members);
  if (!said) return null;
  return (
    <span data-mark-line className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <AvatarMark members={members} size={size} />
      <span className="min-w-0 truncate">{said}</span>
    </span>
  );
}

/** Whether a thread's row draws the avatar mark instead of its status mark. */
export const drawsFaces = (members: Members) => !!avatarMark(members);
