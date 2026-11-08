import type { CrewPR } from '@omni/client-core';
import { crewLine } from '@omni/shared/thread-glance.ts';

import { Section } from '../review/parts';
import { Chip } from '../ui/Chip';
import { ListRow } from '../ui/GroupedList';
import { crewRows } from './model';

/** The PRs the threads this one delegated to opened. A tap shows that PR on this screen, with its merge and the thread that opened it. */
export function CrewPRList({ crew, shown, onOpen }: { crew: CrewPR[]; shown: string | null; onOpen: (pr: CrewPR) => void }) {
  return (
    <Section title={`From delegated threads · ${crewLine(crew).text}`}>
      {crewRows(crew).map((r, i) => (
        <ListRow
          key={r.key}
          first={i === 0}
          title={r.title}
          detail={r.detail}
          trailing={<Chip label={r.badge.label} tone={r.badge.tone} />}
          chevron={r.key !== shown}
          onPress={r.key === shown ? undefined : () => onOpen(r.pr)}
          accessibilityHint="Shows this pull request"
        />
      ))}
    </Section>
  );
}
