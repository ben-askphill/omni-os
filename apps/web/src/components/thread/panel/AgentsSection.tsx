import { useState, type ReactNode } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { type ThreadLinks } from '@omni/shared/continue-flow.ts';
import type { BackgroundTask, Thread } from '../../../api.ts';
import { href } from '../../../router.ts';
import { harnessLabel, HarnessLogo } from '../../brand.tsx';
import { Icon, STATUS_LABEL, StatusDot, type IconName } from '../../ui.tsx';
import { SubagentRow } from './RunningSubagents.tsx';
import { isWorking } from '@omni/shared/delegate-count.ts';

/** A thread's harness logo with its status dot on the corner, the way the panel marks every agent. */
function AgentMark({ harness, status, icon }: { harness?: string; status: string; icon?: IconName }) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center text-fg-3">
      {icon ? <Icon name={icon} size={15} /> : <HarnessLogo harness={harness ?? 'claude-code'} size={15} title={harnessLabel(harness ?? 'claude-code')} />}
      <StatusDot status={status} size={6} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-bg" />
    </span>
  );
}

/** One thread in the agents card: its mark, title and status or age, opening the thread. */
function AgentLink({ to, title, mark, side, sub }: { to: string; title: string; mark: ReactNode; side: string; sub?: string }) {
  return (
    <a href={href.thread(to)} title={sub ? `${sub}: ${title}` : title} className="hov flex h-9 min-w-0 items-center gap-2.5 rounded-full px-3 text-[12.5px] [--hov:var(--surface)]">
      {mark}
      <span className="min-w-0 flex-1 truncate">
        {sub && <span className="text-fg-3">{sub} </span>}
        {title || 'Untitled'}
      </span>
      <span className="shrink-0 text-[11px] text-fg-3">{side}</span>
    </a>
  );
}


/** The card's element id: a delegate count in the sidebar opens Details scrolled to it. */
export const AGENTS_CARD_ID = 'thread-agents';
const statusText = (s: string) => STATUS_LABEL[s] ?? s;

/**
 * Where the thread sits among its agents: the thread it came from (parent or continued from), what it handed on to,
 * the sub-agents running inside it and the threads it delegated. Running agents stay in view; finished ones fold under
 * Previous agents. Nothing when the thread stands alone.
 */
export function AgentsSection({ parent, links, children, agents, onJump, now = Date.now() }: { parent: Thread | null; links: ThreadLinks; children: Thread[]; agents: BackgroundTask[]; onJump: (eventId: number) => void; now?: number }) {
  const [showPrev, setShowPrev] = useState(true);
  const running = children.filter(isWorking);
  const previous = children.filter((c) => !isWorking(c));
  const lineage = !!parent || !!links.from || links.into.length > 0;
  if (!lineage && !agents.length && !children.length) return null;
  return (
    <section id={AGENTS_CARD_ID} aria-label="Agents" className="scroll-mt-3 rounded-[20px] bg-bg p-1">
      {lineage && (
        <>
          <div className="caption px-3 pt-2 pb-1">Lineage</div>
          {parent && <AgentLink to={parent.id} title={parent.title} mark={<AgentMark icon="arrowUpRight" status={parent.status} />} sub="From" side={statusText(parent.status)} />}
          {links.from && <AgentLink to={links.from.id} title={links.from.title} mark={<AgentMark harness={links.from.harness} status={links.from.status} />} sub="Continued from" side={relTime(links.from.created_at, now)} />}
          {links.into.map((l) => (
            <AgentLink key={l.id} to={l.id} title={l.title} mark={<AgentMark harness={l.harness} status={l.status} />} sub="Continued in" side={relTime(l.created_at, now)} />
          ))}
        </>
      )}
      {(agents.length > 0 || running.length > 0) && (
        <>
          <div className={`caption flex items-center px-3 pb-1 ${lineage ? 'mt-1 border-t border-line pt-2.5' : 'pt-2'}`}>
            Running
            <span className="ml-auto font-num text-[11px] text-fg-3">{agents.length + running.length}</span>
          </div>
          {running.map((c) => (
            <AgentLink key={c.id} to={c.id} title={c.title} mark={<AgentMark harness={c.harness} status={c.status} />} side={relTime(c.updated_at, now)} />
          ))}
          {agents.map((t) => (
            <SubagentRow key={t.task_id} t={t} onJump={onJump} />
          ))}
        </>
      )}
      {previous.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showPrev}
            onClick={() => setShowPrev((v) => !v)}
            className={`hov flex h-9 w-full items-center gap-2.5 rounded-full px-3 text-left text-[12.5px] text-fg-2 [--hov:var(--surface)] ${lineage || agents.length || running.length ? 'mt-1' : ''}`}
          >
            <Icon name="delegate" size={15} className="shrink-0 text-fg-3" />
            <span className="flex-1">Previous agents</span>
            <span className="font-num text-[11px] text-fg-3">{previous.length}</span>
            <Icon name="chevronDown" size={13} className={`shrink-0 text-fg-4 transition-transform ${showPrev ? '' : '-rotate-90'}`} />
          </button>
          {showPrev &&
            previous.map((c) => <AgentLink key={c.id} to={c.id} title={c.title} mark={<AgentMark harness={c.harness} status={c.status} />} side={relTime(c.updated_at, now)} />)}
        </>
      )}
    </section>
  );
}
