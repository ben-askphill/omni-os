import type { CrewRole } from '../api.ts';
import { CrewMark, isCrewRole } from './brand.tsx';
import { Avatar } from './ui.tsx';

/**
 * A crew role's avatar: the look its file gives it (a shared icon or an emoji, on its background), else a built-in's
 * mark, else its monogram. Settings > Crew and the role pickers draw it.
 */
export function CrewAvatar({ role, size = 28 }: { role: Pick<CrewRole, 'id' | 'name' | 'avatar'>; size?: number }) {
  if (role.avatar?.icon || role.avatar?.bg) return <Avatar name={role.name} channelIcon={role.avatar.icon} avatarBg={role.avatar.bg} size={size} />;
  if (isCrewRole(role.id))
    return (
      <span aria-hidden="true" className="inline-grid shrink-0 place-items-center rounded-full bg-surface-2 text-fg-2" style={{ width: size, height: size }}>
        <CrewMark role={role.id} size={Math.round(size * 0.56)} title="" />
      </span>
    );
  return <Avatar name={role.name} size={size} />;
}
