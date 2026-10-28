import { useState, type ReactNode } from 'react';
import type { ThreadStub } from '../api.ts';
import { href } from '../router.ts';
import { readPref, useApp, writePref } from '../store.tsx';
import { DoneMark, Icon, StatusDot } from './ui.tsx';
import { Loader } from './brand.tsx';

/** A Conductor job row with its delegated threads, using the sidebar's existing tree-row style. */
export function ThreadHandoffs({ parent, children, renderParent, channelIndent = false, idPrefix = 'sidebar', onNavigate }: {
  parent: ThreadStub;
  children: ThreadStub[];
  renderParent: ReactNode;
  channelIndent?: boolean;
  idPrefix?: string;
  onNavigate?: () => void;
}) {
  const pref = `sidebar.handoffs.${parent.id}`;
  const [expanded, setExpanded] = useState(() => readPref(pref, true));
  const toggle = () => setExpanded((open) => {
    writePref(pref, !open);
    return !open;
  });

  return (
    <div className={channelIndent ? 'ml-[25px]' : undefined}>
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} delegated threads for ${parent.title || 'Untitled'}`}
          aria-expanded={expanded}
          aria-controls={`${idPrefix}-handoffs-${parent.id}`}
          onClick={toggle}
          className="hov z-[2] grid h-7 w-5 shrink-0 place-items-center rounded-md text-fg-4 hover:text-fg"
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={11} />
        </button>
        <div className="min-w-0 flex-1">{renderParent}</div>
      </div>
      <div id={`${idPrefix}-handoffs-${parent.id}`} role="group" aria-label={`Threads delegated from ${parent.title || 'Untitled'}`} hidden={!expanded} className="ml-[14px] border-l border-line-strong pl-2">
        {children.map((child, i) => <HandoffLink key={child.id} child={child} last={i === children.length - 1} onNavigate={onNavigate} />)}
      </div>
    </div>
  );
}

function HandoffLink({ child, last, onNavigate }: { child: ThreadStub; last: boolean; onNavigate?: () => void }) {
  const { channels } = useApp();
  const channel = channels.find((c) => c.id === child.channel_id)?.name ?? child.channel_id;
  const title = child.title || 'Untitled';
  const busy = child.status === 'running' || child.status === 'queued';

  return (
    <a
      href={href.thread(child.id)}
      onClick={onNavigate}
      aria-label={`${title}, #${channel}, ${child.status}`}
      title={`${title} · #${channel} · ${child.status}`}
      className="hov relative z-[1] flex h-7 min-w-0 items-center gap-2 rounded-full px-2 text-[11.5px] text-fg-3 transition-colors hover:text-fg"
    >
      <span aria-hidden className={`pointer-events-none absolute -left-[9px] top-0 w-2 border-l border-line-strong ${last ? 'h-1/2 rounded-bl-[6px] border-b' : 'h-full'}`} />
      <span className="grid w-2.5 shrink-0 place-items-center" aria-hidden="true">
        {busy ? <Loader size={10} className="text-live-text" /> : child.done_at ? <DoneMark size={7} /> : <StatusDot status={child.status} size={7} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="max-w-[40%] shrink-0 truncate rounded-full bg-surface-2 px-1.5 text-[9px] leading-[16px] text-fg-3">#{channel}</span>
    </a>
  );
}
