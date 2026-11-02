import type { CrewPR } from '../api.ts';
import { Chip } from '../components/ui.tsx';
import { crewLine, prBadge } from '@omni/shared/thread-glance.ts';
import { MoGroup, MoListRow, MoSection } from './parts.tsx';

/** The PRs the threads this one delegated to opened. A row shows that PR, with its merge and the thread that opened it. */
export function CrewPRList({ crew, onOpen }: { crew: CrewPR[]; onOpen: (pr: CrewPR) => void }) {
  return (
    <MoSection title="From delegated threads" count={crew.length} right={<span className="text-[12px] leading-[1.3] text-fg-4">{crewLine(crew).text}</span>} pad={false}>
      <MoGroup>
        {crew.map((p, i) => {
          const b = prBadge(p);
          return (
            <MoListRow
              key={p.url}
              label={p.title}
              sub={[`#${p.number}`, p.task_id, p.thread_title].filter(Boolean).join(' · ')}
              right={<Chip tone={b.tone}>{b.label}</Chip>}
              onClick={() => onOpen(p)}
              last={i === crew.length - 1}
            />
          );
        })}
      </MoGroup>
    </MoSection>
  );
}
