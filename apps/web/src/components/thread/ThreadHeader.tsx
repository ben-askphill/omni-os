import type { ComponentProps } from 'react';
import type { Channel, ModStatus, Thread } from '../../api.ts';
import { headerShowsRole } from '@omni/shared/crew-role.ts';
import { ChannelStack } from '../ChannelStack.tsx';
import { ContinueCrumbs } from '../ContinueLinks.tsx';
import { CrewMark, isCrewRole } from '../brand.tsx';
import { Avatar, Chip, Icon } from '../ui.tsx';
import { href } from '../../router.ts';
import { HeaderActions } from './HeaderActions.tsx';

/** The status lines the thread's mods pinned with $.ui.status, one per plugin, while its process runs. */
function ModStatusLines({ lines }: { lines: ModStatus[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-fg-3" aria-label="Mod status">
      {lines.map((m) => (
        <span key={m.plugin} className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={`${m.plugin}: ${m.text}`}>
          <span className="h-1 w-1 shrink-0 rounded-full bg-fg-4" />
          <span className="shrink-0 font-mono text-[10.5px] text-fg-3">{m.plugin}</span>
          <span className="min-w-0 truncate">{m.text}</span>
        </span>
      ))}
    </div>
  );
}

/** The crew role the thread runs as, beside the crumbs: its mark when it has one, and its name. */
function RoleChip({ role, name }: { role: string; name: string }) {
  return (
    <Chip className="ml-1 gap-1 font-normal" title={`Runs as ${name}`}>
      {isCrewRole(role) && <CrewMark role={role} size={12} className="text-fg-3" />}
      <span data-role={role}>{name}</span>
    </Chip>
  );
}

/**
 * The thread page's header: the channel and parent crumbs, the crew role it runs as, the title, mod status lines, the
 * channels its delegated threads work in and the header actions. `delegated`: those threads, finished ones and team
 * members included.
 */
export function ThreadHeader({
  thread,
  channel,
  parent,
  links,
  modLines,
  delegated,
  actions,
  roleName = null,
}: {
  thread: Thread;
  channel: Channel | null | undefined;
  parent: Pick<Thread, 'id' | 'title'> | null;
  links: ComponentProps<typeof ContinueCrumbs>['links'];
  modLines: ModStatus[];
  delegated: readonly Thread[];
  actions: ComponentProps<typeof HeaderActions>;
  /** The display name of its crew role (crewRoleName), shown when headerShowsRole says so. */
  roleName?: string | null;
}) {
  return (
    <div className="@container flex shrink-0 items-center gap-3 px-3 pt-3 pb-2 md:px-6 md:pt-4">
      <span className="hidden sm:block @max-3xl:hidden">
        <Avatar name={channel?.name ?? thread.channel_id} channelIcon={channel?.icon} avatarBg={channel?.avatar_bg} omni={thread.channel_id === 'conductor'} size={34} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1 text-[12px] text-fg-3">
          <a href={href.channel(thread.channel_id)} className="shrink-0 hover:text-fg">
            #{channel?.name ?? thread.channel_id}
          </a>
          {parent && (
            <>
              <Icon name="chevronRight" size={12} className="shrink-0 text-fg-3" />
              <a href={href.thread(parent.id)} className="min-w-0 truncate hover:text-fg" title={`Delegated from ${parent.title}`}>
                {parent.title}
              </a>
            </>
          )}
          {roleName && headerShowsRole(thread) && <RoleChip role={thread.role!} name={roleName} />}
          {thread.task_id && <span className="ml-1 shrink-0 font-num text-[10.5px] text-fg-3">{thread.task_id}</span>}
          <ContinueCrumbs links={links} />
        </div>
        <h1 className="mt-0.5 truncate font-display text-[length:var(--fs-heading)] leading-snug" title={thread.title}>
          {thread.title}
        </h1>
        {modLines.length > 0 && <ModStatusLines lines={modLines} />}
      </div>
      <ChannelStack threads={delegated} own={thread.channel_id} to={href.threadView(thread.id, 'details')} className="mr-1" />
      <HeaderActions {...actions} />
    </div>
  );
}
