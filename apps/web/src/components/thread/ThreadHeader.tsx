import type { ComponentProps } from 'react';
import type { Channel, ModStatus, Thread } from '../../api.ts';
import { headerShowsRole } from '@omni/shared/crew-role.ts';
import { isRemoteAgentHarness, TALKS_ONLY } from '@omni/shared/remote-agent.ts';
import { ChannelStack } from '../ChannelStack.tsx';
import { ContinueCrumbs } from '../ContinueLinks.tsx';
import { harnessLabel } from '../brand.tsx';
import { AgentAvatar, useAgent } from '../AgentAvatar.tsx';
import { threadAccountLabel, type ThreadAccount } from '@omni/shared/harness-accounts.ts';
import { Avatar, Chip, Icon } from '../ui.tsx';
import { href } from '../../router.ts';
import { HeaderActions } from './HeaderActions.tsx';
import { MemberAvatars } from './Members.tsx';
import { agentShows } from '@omni/shared/crew-eyes.ts';
import type { FaceShows } from '@omni/shared/agent-avatar.ts';
import type { Mark } from '@omni/shared/status.ts';

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

/**
 * The channel's and the agent's share of the crumbs: at most 30% each while the parent's title sits between them, which
 * takes what is left, and once the parent is gone both shrink only when the two of them do not fit.
 */
const CRUMB_SHARE = 'max-w-[30%] @max-[15rem]/crumbs:max-w-none @max-[15rem]/crumbs:shrink';

/** The agent the thread runs as, its lead, beside the crumbs: its avatar, showing what it does, and its name. */
function RoleChip({ role, name, shows }: { role: string; name: string; shows: FaceShows | undefined }) {
  const look = useAgent(role);
  return (
    <Chip className={`ml-1 min-w-12 gap-1 font-normal ${CRUMB_SHARE}`} title={`Runs as ${name}`}>
      {look && <AgentAvatar agent={{ ...look, name }} size={16} shows={shows} placement="focus" className="shrink-0" />}
      <span data-role={role} className="min-w-0 truncate">
        {name}
      </span>
    </Chip>
  );
}

/** The account the thread's harness last ran as (apps/server/harness-accounts.ts), after the crumbs. */
function AccountChip({ ran }: { ran: ThreadAccount | null | undefined }) {
  if (!ran) return null;
  return (
    <span className="ml-1 inline-flex min-w-14 items-center gap-1 text-fg-3 @max-[36rem]/crumbs:hidden" title={`${harnessLabel(ran.harness)} runs as ${ran.label}${ran.org ? ` (${ran.org})` : ''} on ${ran.machineName}`}>
      <Icon name="user" size={12} className="shrink-0" />
      <span className="min-w-0 truncate">{threadAccountLabel(ran)}</span>
    </span>
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
  account = null,
  mark = 'idle',
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
  /** The account its harness last ran as (useThreadAccount). */
  account?: ThreadAccount | null;
  /** The thread's status mark, as the header's pill draws it: the lead's eyes show it (ADR 0021). */
  mark?: Mark;
}) {
  const remoteLead = isRemoteAgentHarness(thread.harness) && !!thread.role;
  return (
    <div className="@container flex shrink-0 items-center gap-3 px-3 pt-3 pb-2 md:px-6 md:pt-4">
      <span className="hidden sm:block @max-3xl:hidden">
        <Avatar name={channel?.name ?? thread.channel_id} channelIcon={channel?.icon} avatarBg={channel?.avatar_bg} omni={thread.channel_id === 'conductor'} size={34} />
      </span>
      <div className="min-w-0 flex-1">
        {/* The crumbs keep to one line and never run into the header's buttons. The parent's title, the account and the
            continued threads truncate but keep a few letters. As the line narrows the account, the continued threads, the
            task id and then the parent drop out whole, so no bare chevron, separator or icon is left. */}
        <div className="@container/crumbs flex min-w-0 items-center gap-1 text-[12px] text-fg-3">
          <a href={href.channel(thread.channel_id)} className={`min-w-8 shrink-0 truncate hover:text-fg ${CRUMB_SHARE}`}>
            #{channel?.name ?? thread.channel_id}
          </a>
          {parent && (
            <>
              <Icon name="chevronRight" size={12} className="shrink-0 text-fg-3 @max-[15rem]/crumbs:hidden" />
              <a href={href.thread(parent.id)} className="min-w-8 truncate hover:text-fg @max-[15rem]/crumbs:hidden" title={`Delegated from ${parent.title}`}>
                {parent.title}
              </a>
            </>
          )}
          {roleName && (headerShowsRole(thread) || remoteLead) && <RoleChip role={thread.role!} name={roleName} shows={agentShows(thread.members, thread.role, mark)} />}
          {/* A remote agent leads talk-only; a local member seated in it changes files (ADR 0020). */}
          {remoteLead && (
            <span className="shrink-0" data-talks-only>
              · {TALKS_ONLY}
            </span>
          )}
          {thread.task_id && <span className="ml-1 shrink-0 font-num text-[10.5px] text-fg-3 @max-[24rem]/crumbs:hidden">{thread.task_id}</span>}
          <AccountChip ran={account} />
          <span className="contents @max-[30rem]/crumbs:hidden">
            <ContinueCrumbs links={links} />
          </span>
        </div>
        <h1 className="mt-0.5 line-clamp-2 font-display text-[length:var(--fs-heading)] leading-snug text-balance" title={thread.title}>
          {thread.title}
        </h1>
        {modLines.length > 0 && <ModStatusLines lines={modLines} />}
      </div>
      <ChannelStack threads={delegated} own={thread.channel_id} to={href.threadView(thread.id, 'details')} className="mr-1" />
      <MemberAvatars thread={thread} />
      <HeaderActions {...actions} />
    </div>
  );
}
