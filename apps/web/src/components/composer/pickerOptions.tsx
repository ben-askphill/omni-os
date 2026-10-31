import { CHANNEL_KIND } from '../../format.ts';
import { CrewMark, isCrewRole } from '../brand.tsx';
import type { PickerOption } from '../ui.tsx';
import type { useApp } from '../../store.tsx';

type Channels = ReturnType<typeof useApp>['channels'];
type Crew = ReturnType<typeof useApp>['crew'];

/** The new-thread composer's Channel and Role pickers: the channels still open (plus the one in use) and the crew. */
export function pickerOptions(visibleChannels: Channels, channel: string, crew: Crew) {
  const channelOptions: PickerOption<string>[] = visibleChannels.map((c) => ({
    value: c.id,
    label: c.id === 'conductor' ? 'Conductor' : c.name,
    sub: CHANNEL_KIND[c.kind] ?? c.kind,
    avatar: c.name,
    icon: c.id === 'conductor' ? 'target' : undefined,
  }));
  if (!visibleChannels.some((c) => c.id === channel)) channelOptions.push({ value: channel, label: channel, avatar: channel });
  const roleOptions: PickerOption<string>[] = [
    { value: '', label: 'No role', sub: 'No charter', avatar: false, icon: 'x' },
    ...crew.map((r) => ({ value: r.id, label: r.name, sub: r.description, avatar: r.name, lead: isCrewRole(r.id) ? <CrewMark role={r.id} size={13} /> : undefined })),
  ];
  return { channelOptions, roleOptions };
}
