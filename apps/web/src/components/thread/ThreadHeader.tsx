import type { ComponentProps } from 'react';
import type { Channel, ModStatus, Thread } from '../../api.ts';
import { ContinueCrumbs } from '../ContinueLinks.tsx';
import { Avatar, Icon } from '../ui.tsx';
import { href } from '../../router.ts';
import { HeaderActions } from './HeaderActions.tsx';

/** The status lines the thread's mods pinned with $.ui.status, one per plugin, while its process runs. */
function ModStatusLines({ lines }: { lines: ModStatus[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-fg-3" aria-label="Mod status">
      {lines.map((m) => (
        <span key={m.plugin} className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={`${m.plugin}: ${m.text}`}>
          <span className="h-1 w-1 shrink-0 rounded-full bg-fg-4" />
          <span className="shrink-0 font-mono text-[10.5px] text-fg-4">{m.plugin}</span>
          <span className="min-w-0 truncate">{m.text}</span>
        </span>
      ))}
    </div>
  );
}

/** The thread page's header: the channel and parent crumbs, the title, mod status lines and the header actions. */
export function ThreadHeader({
  thread,
  channel,
  parent,
  links,
  modLines,
  actions,
}: {
  thread: Thread;
  channel: Channel | null | undefined;
  parent: Pick<Thread, 'id' | 'title'> | null;
  links: ComponentProps<typeof ContinueCrumbs>['links'];
  modLines: ModStatus[];
  actions: ComponentProps<typeof HeaderActions>;
}) {
  return (
    <div className="@container flex shrink-0 items-center gap-3 px-3 pt-3 pb-2 md:px-6 md:pt-4">
      <span className="hidden sm:block @max-3xl:hidden">
        <Avatar name={channel?.name ?? thread.channel_id} channelIcon={channel?.icon} icon={thread.channel_id === 'conductor' ? 'target' : undefined} size={34} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1 text-[12px] text-fg-3">
          <a href={href.channel(thread.channel_id)} className="shrink-0 hover:text-fg">
            #{channel?.name ?? thread.channel_id}
          </a>
          {parent && (
            <>
              <Icon name="chevronRight" size={12} className="shrink-0 text-fg-4" />
              <a href={href.thread(parent.id)} className="min-w-0 truncate hover:text-fg" title={`Delegated from ${parent.title}`}>
                {parent.title}
              </a>
            </>
          )}
          {thread.task_id && <span className="ml-1 shrink-0 font-num text-[10.5px] text-fg-4">{thread.task_id}</span>}
          <ContinueCrumbs links={links} />
        </div>
        <h1 className="mt-0.5 truncate font-display text-[16px] leading-snug md:text-[18px]" title={thread.title}>
          {thread.title}
        </h1>
        {modLines.length > 0 && <ModStatusLines lines={modLines} />}
      </div>
      <HeaderActions {...actions} />
    </div>
  );
}
