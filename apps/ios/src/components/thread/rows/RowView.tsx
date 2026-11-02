import { type ComponentType, memo } from 'react';
import { View } from 'react-native';

import type { RowKind, ThreadRow } from '../../../thread/rows';
import { space } from '../../../theme';
import {
  ArtifactRow,
  CloudRow,
  ConductorRow,
  DelegationRow,
  ErrorRow,
  NowRow,
  OutcomeRow,
  PlanRow,
  ProseRow,
  PromptRow,
  QuestionRow,
  ReportRow,
  StepsRow,
  SwitchRow,
} from './Cards';
import { CallRow, ModRow, NoteRow } from './Steps';

type Views = { [K in RowKind]: ComponentType<{ row: Extract<ThreadRow, { kind: K }> }> };

const VIEWS: Views = {
  prompt: PromptRow,
  report: ReportRow,
  question: QuestionRow,
  outcome: OutcomeRow,
  conductor: ConductorRow,
  error: ErrorRow,
  cloud: CloudRow,
  prose: ProseRow,
  delegation: DelegationRow,
  artifact: ArtifactRow,
  steps: StepsRow,
  note: NoteRow,
  call: CallRow,
  mod: ModRow,
  switch: SwitchRow,
  now: NowRow,
  plan: PlanRow,
};

const GAP: Partial<Record<RowKind, number>> = { call: space.s2, note: space.s4, mod: space.s2, switch: space.s4, prompt: space.s9 };

export const RowView = memo(function RowView({ row }: { row: ThreadRow }) {
  const Draw = VIEWS[row.kind] as ComponentType<{ row: ThreadRow }>;
  return (
    <View style={{ paddingTop: GAP[row.kind] ?? space.s6 }}>
      <Draw row={row} />
    </View>
  );
});
