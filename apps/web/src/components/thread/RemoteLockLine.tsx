import { remoteLockLine } from '@omni/shared/remote-agent.ts';
import { href } from '../../router.ts';
import { useApp } from '../../store.tsx';
import { Icon } from '../ui.tsx';

/**
 * The lock line under a remote agent's reply (ADR 0020, How it looks): it could not read the thread's files, which a
 * channel decides. It links Channel settings. The desktop transcript and the phone's turns draw it.
 */
export function RemoteLockLine({ channelId, className = '' }: { channelId: string; className?: string }) {
  const { channel } = useApp();
  const name = channel(channelId)?.name ?? channelId;
  return (
    <p className={`flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3 ${className}`} data-lock-line>
      <Icon name="lock" size={12} className="shrink-0" />
      <a href={href.settings(channelId)} className="min-w-0 truncate underline-offset-2 hover:text-fg hover:underline">
        {remoteLockLine(name)}
      </a>
    </p>
  );
}
