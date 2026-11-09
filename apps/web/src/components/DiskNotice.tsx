import { diskNotice, type DiskView } from '@omni/shared/disk-space.ts';
import { useApi } from '../api.ts';
import { href } from '../router.ts';
import { useFeed } from '../store.tsx';
import { Icon } from './ui.tsx';

/**
 * Shown in the desktop sidebar and on the phone's Activity screen, beside UpdateNotice: the disk with Omni's data, or
 * the temp folder's quota, is running out (apps/server/disk-space.ts). GET /api/disk, fresh on every disk and
 * reconnect message. Nothing while there is room.
 */
export function DiskNotice({ className = '' }: { className?: string }) {
  const { data, reload } = useApi<DiskView>('/disk');
  useFeed((e) => {
    if (e.type === 'disk' || e.type === 'reconnect') reload();
  });
  const notice = diskNotice(data);
  if (!notice) return null;
  const critical = notice.level === 'critical';
  return (
    <div className={`rounded-[20px] bg-bg/70 px-3 py-2.5 shadow-[var(--shadow-card)] ${className}`} role={critical ? 'alert' : 'status'}>
      <div className="flex items-start gap-2">
        <span className={`mt-px shrink-0 ${critical ? 'text-needs' : 'text-fg-3'}`}>
          <Icon name="alert" size={14} />
        </span>
        <div className="min-w-0 flex-1 text-[12px] leading-[1.35]">
          <div className="text-fg">{notice.text}</div>
          <a href={href.settingsSection('worktrees')} className="mt-0.5 block text-fg-3 underline-offset-2 hover:underline">
            {notice.detail}
          </a>
        </div>
      </div>
    </div>
  );
}
