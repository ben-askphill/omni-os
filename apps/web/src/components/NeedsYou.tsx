import type { ReactNode } from 'react';
import { relTime } from '@omni/shared/format.ts';
import type { NeedsYou as Inbox, NeedsYouItem } from '../api.ts';
import { canMarkDone, reasonOf, splitNeeds } from '../needs-you.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { Avatar, Icon, StatusDot, type IconName } from './ui.tsx';

/**
 * One thread that needs Ben: why, and the result's last words or Setup's reason. Opening it reads the result. On
 * hover, a check marks it done: out of here until something new happens in it (right-click has it too).
 */
function NeedsYouRow({ item, showChannel }: { item: NeedsYouItem; showChannel?: boolean }) {
  useNow(60_000);
  const { channels, setDone } = useApp();
  const t = item.thread;
  const reason = reasonOf(item);
  const unread = !!item.result;
  return (
    <div className="group/ny relative">
    <a href={href.thread(t.id)} className="hov group flex items-start gap-3 rounded-[18px] px-3 py-2.5 [--hov:var(--surface)] md:px-3.5">
      {showChannel ? (
        <span className="relative mt-0.5 shrink-0">
          <Avatar name={t.channel_id} omni={t.channel_id === 'conductor'} channelIcon={channels.find((c) => c.id === t.channel_id)?.icon} avatarBg={channels.find((c) => c.id === t.channel_id)?.avatar_bg} size={32} />
          <span className="absolute -right-0.5 -bottom-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-bg">
            <StatusDot status={reason.glyph} size={8} />
          </span>
        </span>
      ) : (
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface transition-colors group-hover:bg-bg">
          <StatusDot status={reason.glyph} size={10} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`min-w-0 truncate text-[14px] group-hover:text-fg ${unread ? 'text-fg' : 'text-fg-2'}`}>{t.title || 'Untitled'}</span>
          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg" aria-label="Unread" role="img" />}
          <span
            className={`ml-auto shrink-0 pl-2 font-num text-[12px] text-fg-3 tabular-nums ${canMarkDone(t.status) ? 'md:group-focus-within/ny:opacity-0 md:group-hover/ny:opacity-0' : ''}`}
          >
            {relTime(item.at)}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-fg-3">
          {showChannel && <span className="shrink-0 text-fg-2">#{t.channel_id}</span>}
          <span className="shrink-0 text-fg-2">{reason.label}</span>
          {reason.detail && <span className="min-w-0 truncate">· {reason.detail}</span>}
        </div>
      </div>
    </a>
    {canMarkDone(t.status) && (
      <button
        type="button"
        aria-label={`Mark ${t.title || 'Untitled'} as done`}
        title="Mark as done"
        onClick={() => void setDone(t.id, true).catch(() => {})}
        className="hov absolute top-2.5 right-2.5 z-[2] grid h-7 w-7 place-items-center rounded-full text-fg-3 opacity-100 transition-opacity [--hov:var(--bg)] hover:text-fg focus-visible:opacity-100 md:opacity-0 md:group-hover/ny:opacity-100 md:group-focus-within/ny:opacity-100"
      >
        <Icon name="check" size={15} />
      </button>
    )}
    </div>
  );
}

/** A list's compact empty state: one line on a surface, with a glyph. Pages keep the big Empty for a whole empty page. */
export function EmptyNote({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 rounded-[var(--r-xl)] bg-surface px-4 py-3.5 text-[length:var(--fs-ui)] leading-[1.4] text-fg-3">
      <Icon name={icon} size={15} className="shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ItemsSection({ label, items, showChannel, empty }: { label: string; items: NeedsYouItem[]; showChannel?: boolean; empty?: ReactNode }) {
  return (
    <section aria-label={label} className="mt-10">
      <h2 className="mb-2 flex items-center gap-2 px-3 font-display text-[length:var(--fs-heading)] md:px-3.5">
        {label}
        {items.length > 0 && <span className="font-num text-[12px] text-fg-3 tabular-nums">{items.length}</span>}
      </h2>
      {items.length ? (
        <div className="flex flex-col">
          {items.map((i) => (
            <NeedsYouRow key={i.thread.id} item={i} showChannel={showChannel} />
          ))}
        </div>
      ) : (
        empty
      )}
    </section>
  );
}

/**
 * Needs you (blocked on Ben: a question, a failure, a usage limit), then Unread (finished, not opened yet). On Home
 * both show and Needs you says when it is clear. In a channel (`quiet`) only Needs you shows, and only with something
 * in it: the channel's own list already shows its finished threads.
 */
export function NeedsYouSection({ inbox, showChannel, quiet }: { inbox: Inbox | null; showChannel?: boolean; quiet?: boolean }) {
  if (!inbox) return null;
  const { needs, unread } = splitNeeds(inbox.items);
  return (
    <>
      {(!quiet || needs.length > 0) && (
        <ItemsSection
          label="Needs you"
          items={needs}
          showChannel={showChannel}
          empty={<EmptyNote icon="check">Nothing needs you. Questions, failures and usage limits show up here.</EmptyNote>}
        />
      )}
      {!quiet && unread.length > 0 && <ItemsSection label="Unread" items={unread} showChannel={showChannel} />}
    </>
  );
}
