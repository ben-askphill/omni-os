// Delegation card: the threads a Conductor (or a team lead) fanned out to, or a thread's own sub-agents, each with its live state.
import type { ReactNode } from 'react';
import { relTime } from '@omni/shared/format.ts';
import type { ReportP } from '@omni/shared/transcript-fold.ts';
import { href } from '../router.ts';
import { useNow } from '../store.tsx';
import type { Branch } from '../transcript/delegation.ts';
import { AgentAvatar, useAgent } from './AgentAvatar.tsx';
import { HarnessMark } from './brand.tsx';
import { Folded } from './Folded.tsx';
import { Markdown } from './Markdown.tsx';
import { Icon, StatusPill } from './ui.tsx';

// The rail's ink: --line-strong flattened onto the page, so the rail and an elbow do not darken where they overlap.
const RAIL_INK = 'border-[color:color-mix(in_srgb,var(--fg)_16%,var(--bg))]';

/**
 * A row on the card's rail. The rail runs down the list's left edge, under the centre of the header's mark. Each
 * row's elbow leaves it and ends level with the middle of `row`, the row's card, however tall that is. After the last
 * row the rail stops at its elbow. `children`: what opens under the card. The row's pill carries its state, so the
 * connector into it stays neutral.
 */
export function RailItem({ row, children }: { row: ReactNode; children?: ReactNode }) {
  return (
    <li className="group/rail relative pl-6">
      {/* On to the next row: half the gap between rows here, the other half from that row's elbow (-top-1). */}
      <span aria-hidden className={`pointer-events-none absolute -top-1 -bottom-1 left-[-0.75px] border-l-[1.5px] group-last/rail:hidden ${RAIL_INK}`} />
      <div className="relative">
        <span
          aria-hidden
          className={`pointer-events-none absolute -top-1 left-[-24.75px] h-[calc(50%+4.75px)] w-[20.75px] rounded-bl-[14px] border-b-[1.5px] border-l-[1.5px] ${RAIL_INK}`}
        />
        {row}
      </div>
      {children}
    </li>
  );
}

export const ROW_CARD = 'press flex w-full min-w-0 items-start gap-3 rounded-[16px] bg-bg px-3.5 py-3 text-left shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card),inset_0_0_0_1px_var(--line)]';

/**
 * What a row shows: the avatar of the agent its thread runs as (`role`), title, a meta line and its state. A row with
 * no agent (a thread without one, or a harness's own sub-agent) shows the layers icon on a disc instead.
 */
export function BranchFace({ role, title, status, children }: { role?: string | null; title: string; status: string; children: ReactNode }) {
  const agent = useAgent(role);
  return (
    <>
      {agent ? (
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center">
          <AgentAvatar agent={agent} size={28} />
        </span>
      ) : (
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-fg-2">
          <Icon name="layers" size={14} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-fg">{title}</span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">{children}</span>
      </span>
      <span className="shrink-0">
        <StatusPill status={status} />
      </span>
    </>
  );
}

/** A thread's answer on its card: the report it sent, shown in place (ReportP `shown`), folded when long. */
export function Answer({ r }: { r: ReportP }) {
  return (
    <div className="mt-2 rounded-[16px] bg-bg px-3.5 py-3 text-[14px] shadow-[var(--shadow-card)]">
      <Folded>
        <Markdown text={r.text || '(no reply)'} />
      </Folded>
    </div>
  );
}

/**
 * `report`: where this thread's crew report is while the parent has not read it (apps/web/src/requests.ts `reportNotes`).
 * `answer`: the report itself, when it showed in place.
 */
function BranchRow({ b, report, answer }: { b: Branch; report?: string; answer?: ReportP }) {
  useNow();
  const busy = b.status === 'running' || b.status === 'queued';
  const when = b.updated_at ? relTime(b.updated_at) : null;
  const detail = busy ? (b.status === 'queued' ? 'waiting for a slot' : when && `started ${when}`) : report ?? (when && `report in · ${when}`);
  return (
    <RailItem
      row={
        <a href={href.thread(b.id)} className={ROW_CARD}>
          <BranchFace role={b.role} title={b.title} status={b.status}>
            {b.role && <span>{b.role}</span>}
            {b.channel && <span>#{b.channel}</span>}
            <HarnessMark harness={b.harness} />
            {b.task_id && <span className="font-mono text-[11.5px] text-fg-2">{b.task_id}</span>}
            {detail && <span className={report && !busy ? 'font-medium text-fg-2' : 'text-fg-3'}>{detail}</span>}
          </BranchFace>
        </a>
      }
    >
      {answer && !busy && <Answer r={answer} />}
    </RailItem>
  );
}

/**
 * `lead`: the team's lead thread, shown in the header with a link, as the Conductor sees it.
 * Without one it is a plain fan-out (the Conductor's delegate calls) or the lead's own view of its team.
 * `agents`: rows for sub-agents the thread's own run launched, which have no thread to link to.
 * A row whose report the thread has not read yet says where it is: on its way, queued, or held for Resume.
 */
export function DelegationCard({
  branches = [],
  lead,
  team = false,
  agents = [],
  reports,
  answers,
  label,
  mark,
}: {
  branches?: Branch[];
  lead?: Branch;
  team?: boolean;
  agents?: ReactNode[];
  /** The header's words and mark, in place of "Delegated 1 task" and the Conductor's: an Ask names the role asked. */
  label?: ReactNode;
  mark?: ReactNode;
  /** Crew reports the thread has not read yet, by the thread that reported: shown on that thread's row. */
  reports?: Map<string, string>;
  /** Reports shown in place, by the thread that sent them: each shows under its row, a lead's under the card. */
  answers?: Record<string, ReportP>;
}) {
  const conductor = useAgent('conductor');
  if (!branches.length && !agents.length && !lead) return null;
  const n = branches.length + agents.length;
  // Every member has reported and the lead is still at it: it is writing the combined answer.
  const combining = lead?.status === 'running' && n > 0 && branches.every((b) => b.status !== 'running' && b.status !== 'queued');
  const what = lead || team ? `Team of ${n}` : `Delegated ${n === 1 ? '1 task' : `${n} tasks`}`;
  return (
    <section aria-label={typeof label === 'string' ? label : what} className="rounded-[20px] px-3.5 pt-3.5 pb-3 shadow-[inset_0_0_0_1px_var(--line)]">
      <header className="mb-2 flex min-w-0 items-center gap-2.5 px-1 text-[13.5px]">
        {mark ?? (conductor && <AgentAvatar agent={conductor} size={16} />)}
        <span className="inline-flex shrink-0 items-center gap-2 font-medium text-fg">{label ?? what}</span>
        {lead && (
          <a href={href.thread(lead.id)} className="min-w-0 truncate text-fg-3 hover:text-fg" title="Open the lead thread">
            {lead.title}
            {lead.channel && <span className="text-fg-3"> · #{lead.channel}</span>}
          </a>
        )}
        {lead && (
          <span className="ml-auto shrink-0">
            <StatusPill status={lead.status} label={combining ? 'Combining' : undefined} />
          </span>
        )}
      </header>
      {/* ml-3: the rail sits under the centre of the header's mark (the header's px-1 plus half the 16px mark). */}
      <ol className="ml-3 flex flex-col gap-2 pt-1">
        {branches.map((b) => (
          <BranchRow key={b.id} b={b} report={reports?.get(b.id)} answer={answers?.[b.id]} />
        ))}
        {agents}
      </ol>
      {lead && answers?.[lead.id] && lead.status !== 'running' && <Answer r={answers[lead.id]} />}
    </section>
  );
}
