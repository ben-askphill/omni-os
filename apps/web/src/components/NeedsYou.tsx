import type { NeedsYou as Inbox, NeedsYouItem } from '../api.ts';
import { relTime } from '../format.ts';
import { reasonOf } from '../needs-you.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { Avatar, StatusDot } from './ui.tsx';

/** One thread that needs Ben: why, and the result's last words or Setup's reason. Opening it reads the result. */
function NeedsYouRow({ item, showChannel }: { item: NeedsYouItem; showChannel?: boolean }) {
  useNow(60_000);
  const { channels } = useApp();
  const t = item.thread;
  const reason = reasonOf(item);
  const unread = !!item.result;
  return (
    <a href={href.thread(t.id)} className="hov group flex items-start gap-3 rounded-[18px] px-3 py-3 [--hov:var(--surface)] md:px-3.5">
      {showChannel ? (
        <span className="relative mt-0.5 shrink-0">
          <Avatar name={t.channel_id} channelIcon={channels.find((c) => c.id === t.channel_id)?.icon} size={32} />
          <span className="absolute -right-0.5 -bottom-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-bg">
            <StatusDot status={reason.glyph} size={8} />
          </span>
        </span>
      ) : (
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface transition-colors group-hover:bg-bg">
          <StatusDot status={reason.glyph} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`min-w-0 truncate text-[14px] group-hover:text-fg ${unread ? 'text-fg' : 'text-fg-2'}`}>{t.title || 'Untitled'}</span>
          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg" aria-label="Unread" role="img" />}
          <span className="ml-auto shrink-0 pl-2 font-num text-[11px] text-fg-4 tabular-nums">{relTime(item.at)}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-3">
          {showChannel && <span className="shrink-0 text-fg-2">#{t.channel_id}</span>}
          <span className="shrink-0 text-fg-2">{reason.label}</span>
          {reason.detail && <span className="min-w-0 truncate">· {reason.detail}</span>}
        </div>
      </div>
    </a>
  );
}

/** The Needs you section of Home and of a channel. Hidden in a channel with nothing in it; Home says all clear. */
export function NeedsYouSection({ inbox, showChannel, quiet }: { inbox: Inbox | null; showChannel?: boolean; quiet?: boolean }) {
  if (!inbox || (quiet && !inbox.items.length)) return null;
  const parts = [inbox.unread && `${inbox.unread} unread`, inbox.blocked && `${inbox.blocked} blocked`].filter(Boolean).join(' · ');
  return (
    <section aria-label="Needs you" className="mt-10">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2 font-display text-[17px]">
          Needs you
          {inbox.items.length > 0 && <span className="font-num text-[11.5px] text-fg-4 tabular-nums">{inbox.items.length}</span>}
        </h2>
        {parts && <span className="font-num text-[11.5px] text-fg-4 tabular-nums">{parts}</span>}
      </div>
      {inbox.items.length ? (
        <div className="flex flex-col">
          {inbox.items.map((i) => (
            <NeedsYouRow key={i.thread.id} item={i} showChannel={showChannel} />
          ))}
        </div>
      ) : (
        <p className="px-1 text-[12.5px] text-fg-4">All caught up. Finished and failed threads you have not opened show up here.</p>
      )}
    </section>
  );
}
