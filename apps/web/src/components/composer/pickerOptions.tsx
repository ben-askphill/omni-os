import { CONDUCTOR_CHANNEL, hasOwnLook } from '@omni/shared/channel-icon.ts';
import { CHANNEL_KIND } from '../../format.ts';
import { CrewMark, isCrewRole, StaticMark } from '../brand.tsx';
import type { PickerOption } from '../ui.tsx';
import type { useApp } from '../../store.tsx';

type Channels = ReturnType<typeof useApp>['channels'];
type Crew = ReturnType<typeof useApp>['crew'];

/**
 * A channel option's avatar: its icon and background, and for the Conductor the bare Omni mark until it has a look of
 * its own (hasOwnLook).
 */
export function channelAvatar(c: Channels[number]): Pick<PickerOption<string>, 'avatar' | 'avatarBg' | 'channelIcon' | 'omni' | 'lead'> {
  const conductor = c.id === CONDUCTOR_CHANNEL;
  return { avatar: c.name, avatarBg: c.avatar_bg, channelIcon: c.icon, omni: conductor, lead: conductor && !hasOwnLook(c) ? <StaticMark size={13} title="" /> : undefined };
}

/**
 * The new-thread composer's Channel and Role pickers: the channels still open (plus the one in use) and the crew. A role
 * the Conductor may not delegate to (usage-scan) is left out, as list_crew leaves it out; the Conductor stays, since
 * the composer attaches it in #conductor. Each role wears its avatar, as CrewAvatar draws it: its own look, else a
 * built-in's mark, else its initials.
 */
export function pickerOptions(visibleChannels: Channels, channel: string, crew: Crew) {
  const channelOptions: PickerOption<string>[] = visibleChannels.map((c) => ({
    value: c.id,
    label: c.id === 'conductor' ? 'Conductor' : c.name,
    sub: CHANNEL_KIND[c.kind] ?? c.kind,
    ...channelAvatar(c),
  }));
  if (!visibleChannels.some((c) => c.id === channel)) channelOptions.push({ value: channel, label: channel, avatar: channel });
  const roleOptions: PickerOption<string>[] = [
    { value: '', label: 'No role', sub: 'No charter', avatar: false, icon: 'user' },
    ...crew
      .filter((r) => r.delegatable !== false || r.id === CONDUCTOR_CHANNEL)
      .map((r) => ({
        value: r.id,
        label: r.name,
        sub: r.description,
        avatar: r.name,
        channelIcon: r.avatar?.icon,
        avatarBg: r.avatar?.bg,
        lead: !r.avatar && isCrewRole(r.id) ? <CrewMark role={r.id} size={13} /> : undefined,
      })),
  ];
  return { channelOptions, roleOptions };
}
