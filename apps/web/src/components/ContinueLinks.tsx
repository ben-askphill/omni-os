import type { ReactNode } from 'react';
import { carriedText, type ContinueLink } from '@omni/shared/continue.ts';
import { newestLink, type ThreadLinks } from '../continue.ts';
import { href } from '../router.ts';
import { harnessLabel } from './brand.tsx';
import { Icon, StatusDot } from './ui.tsx';

/** "Fix the flaky test · Claude Code": a linked thread by its title and the harness it runs on. */
export const linkName = (l: ContinueLink) => `${l.title || 'Untitled'} · ${harnessLabel(l.harness)}`;

function Crumb({ to, title, children }: { to: ContinueLink; title?: string; children: ReactNode }) {
  return (
    <>
      <span className="shrink-0 text-fg-4">·</span>
      <a href={href.thread(to.id)} title={title} className="min-w-0 truncate hover:text-fg">
        {children}
      </a>
    </>
  );
}

/** In the desktop thread header's breadcrumb: the thread this one continues, and the newest that continues it. */
export function ContinueCrumbs({ links }: { links: ThreadLinks }) {
  const next = newestLink(links.into);
  const more = links.into.length - 1;
  return (
    <>
      {links.from && (
        <Crumb to={links.from} title={links.from.carried ? carriedText(links.from.carried) : undefined}>
          Continued from {linkName(links.from)}
        </Crumb>
      )}
      {next && (
        <Crumb to={next} title={more > 0 ? `${more} more in Details` : undefined}>
          Continued in {linkName(next)}
          {more > 0 && ` +${more}`}
        </Crumb>
      )}
    </>
  );
}

/** One linked thread in a desktop Details row. Under the thread this one continues, what it carried over. */
export function ContinueLinkItem({ link, carried }: { link: ContinueLink; carried?: boolean }) {
  return (
    <div className="min-w-0">
      <a href={href.thread(link.id)} className="inline-flex max-w-full items-center gap-1.5 hover:underline">
        <StatusDot status={link.status} size={6} />
        <span className="truncate">{link.title || 'Untitled'}</span>
        <span className="shrink-0 text-fg-3">· {harnessLabel(link.harness)}</span>
      </a>
      {carried && link.carried && <div className="mt-0.5 text-fg-3">{carriedText(link.carried)}</div>}
    </div>
  );
}

/** Above a phone thread's first turn: where it came from and where it carries on, each opening that thread. */
export function MoContinueLinks({ links, onOpen }: { links: ThreadLinks; onOpen: (id: string) => void }) {
  const rows = [...(links.from ? [{ dir: 'Continued from', link: links.from }] : []), ...links.into.map((link) => ({ dir: 'Continued in', link }))];
  if (!rows.length) return null;
  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-[20px] bg-surface">
      {rows.map(({ dir, link }, i) => (
        <button
          key={link.id}
          type="button"
          onClick={() => onOpen(link.id)}
          className={`mo-press flex items-center gap-2.5 px-3.5 py-2.5 text-left ${i ? 'border-t border-line' : ''}`}
        >
          <Icon name="branch" size={15} className="shrink-0 text-fg-3" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[14px] leading-[1.3]">
              <span className="text-fg-3">{dir}</span> {link.title || 'Untitled'}
            </span>
            <span className="text-[12px] leading-[1.35] text-pretty text-fg-3">
              {harnessLabel(link.harness)}
              {link === links.from && link.carried && ` · ${carriedText(link.carried)}`}
            </span>
          </span>
          <Icon name="chevronRight" size={15} className="shrink-0 text-fg-4" />
        </button>
      ))}
    </div>
  );
}
