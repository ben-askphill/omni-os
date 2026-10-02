// Delegation card: the threads a Conductor (or a team lead) fanned out to, each with its live state.
import { relTime } from '../format.ts';
import { href } from '../router.ts';
import { useNow } from '../store.tsx';
import type { Branch } from '../transcript/delegation.ts';
import { CrewMark, HarnessMark, isCrewRole } from './brand.tsx';
import { Icon, StatusPill, glyphFor } from './ui.tsx';

/** The rail colour into each row follows its state: ink when done, blue while running, orange when it needs Ben. */
const RAIL: Record<string, string> = {
  done: 'border-fg',
  running: 'border-live',
  queued: 'border-live',
  needs: 'border-needs',
};

function BranchRow({ b }: { b: Branch }) {
  useNow();
  const g = glyphFor(b.status);
  const busy = b.status === 'running' || b.status === 'queued';
  const when = b.updated_at ? relTime(b.updated_at) : null;
  const detail = busy ? (b.status === 'queued' ? 'waiting for a slot' : when && `started ${when}`) : when && `report in · ${when}`;
  return (
    <li className="relative pl-6">
      <span aria-hidden className={`absolute top-0 left-0 h-[34px] w-5 rounded-bl-[14px] border-b-[1.5px] border-l-[1.5px] ${RAIL[g] ?? 'border-line-strong'}`} />
      <a
        href={href.thread(b.id)}
        className="press flex min-w-0 items-start gap-3 rounded-[20px] bg-bg px-3.5 py-3 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card),inset_0_0_0_1px_var(--line)]"
      >
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-fg-2">
          {isCrewRole(b.role) ? <CrewMark role={b.role} size={15} /> : <Icon name="layers" size={14} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-fg">{b.title}</span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
            {b.role && <span>{b.role}</span>}
            {b.channel && <span>#{b.channel}</span>}
            <HarnessMark harness={b.harness} />
            {b.task_id && <span className="font-mono text-[11.5px] text-fg-2">{b.task_id}</span>}
            {detail && <span className="text-fg-4">{detail}</span>}
          </span>
        </span>
        <span className="shrink-0">
          <StatusPill status={b.status} />
        </span>
      </a>
    </li>
  );
}

/**
 * `lead`: the team's lead thread, shown in the header with a link, as the Conductor sees it.
 * Without one it is a plain fan-out (the Conductor's delegate calls) or the lead's own view of its team.
 */
export function DelegationCard({ branches, lead, team = false }: { branches: Branch[]; lead?: Branch; team?: boolean }) {
  if (!branches.length && !lead) return null;
  const ids = branches.map((b) => b.task_id).filter(Boolean);
  const n = branches.length;
  // Every member has reported and the lead is still at it: it is writing the combined answer.
  const combining = lead?.status === 'running' && n > 0 && branches.every((b) => b.status !== 'running' && b.status !== 'queued');
  const what = lead || team ? `Team of ${n}` : `Delegated ${n === 1 ? '1 task' : `${n} tasks`}`;
  return (
    <section aria-label={what} className="rounded-[24px] bg-surface px-3.5 pt-3.5 pb-3">
      <header className="mb-2 flex min-w-0 items-center gap-2.5 px-1 text-[13.5px]">
        <CrewMark role="conductor" size={16} className="text-fg" />
        <span className="shrink-0 font-medium text-fg">{what}</span>
        {lead ? (
          <a href={href.thread(lead.id)} className="min-w-0 truncate text-fg-3 hover:text-fg" title="Open the lead thread">
            {lead.title}
            {lead.channel && <span className="text-fg-4"> · #{lead.channel}</span>}
          </a>
        ) : (
          <span className="min-w-0 truncate font-mono text-[11.5px] text-fg-4">{ids.join(' ')}</span>
        )}
        {lead && (
          <span className="ml-auto shrink-0">
            <StatusPill status={lead.status} label={combining ? 'Combining' : undefined} />
          </span>
        )}
      </header>
      <ol className="ml-2 flex flex-col gap-2 border-l-[1.5px] border-line pt-1">
        {branches.map((b) => (
          <BranchRow key={b.id} b={b} />
        ))}
      </ol>
    </section>
  );
}
