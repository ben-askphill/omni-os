// The avatar mark (ADR 0019, Q35, Q68): while a group thread's agents run or wait on Ben, their avatars are the
// thread's status mark, the one asking first, then the working ones, two at most, else one and a count. Each face shows
// its own state in its eyes, or a photo's or icon's ring (ADR 0021, D8). Beside them, never on a face, sit the Needs
// you diamond while one asks and a red dot for an agent that failed. The desktop thread lists, Inbox cards and the
// Overview dashboard draw it in the mark's place; the phone rows say it on their second line (MarkLine). Rules in
// @omni/shared/members.ts.
import { avatarMark, markLine, type MarkFace, type ThreadMember } from '@omni/shared/members.ts';
import { AgentAvatar, useAgent } from '../AgentAvatar.tsx';
import { StatusDot } from '../ui/status.tsx';

type Members = readonly Pick<ThreadMember, 'agent' | 'name' | 'lead' | 'state'>[] | undefined;

/** One face, showing its member state: working, or waiting on Ben. */
function Face({ face, size }: { face: MarkFace; size: number }) {
  const agent = useAgent(face.agent) ?? { id: face.agent, name: face.name };
  return (
    <span className="inline-grid shrink-0" data-face={face.ring}>
      <AgentAvatar agent={{ ...agent, name: face.name }} size={size} shows={{ member: face.ring }} placement="row" />
    </span>
  );
}

/** The faces, the diamond and the dot, with what they say as the label. Null while no agent works or waits on Ben. */
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
      {mark.faces[0].ring === 'needs' && (
        <span aria-hidden="true" data-needs-mark className="ml-1 inline-flex shrink-0">
          <StatusDot mark="question" size={Math.max(7, Math.round(size * 0.5))} />
        </span>
      )}
      {mark.failed && <span aria-hidden="true" data-failed-dot className="ml-1 h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--needs)]" />}
    </span>
  );
}

/** The phone row's second line (Q35 pick C): the faces, then who asks and who works in words. Null when none does. */
export function MarkLine({ members, size = 16, className = '' }: { members: Members; size?: number; className?: string }) {
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
