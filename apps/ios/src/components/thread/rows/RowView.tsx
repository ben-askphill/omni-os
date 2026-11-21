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
  ProgressRow,
  ProseRow,
  PromptRow,
  QuestionRow,
  ReportRow,
  StepsRow,
  SwitchRow,
} from './Cards';
import { AuthorRow, CollisionRow, FilesRow, LanesRow, LockRow, MemberRow, REPLY_INSET } from './Group';
import { CallRow, ModRow, NoteRow } from './Steps';
import { MergeRiskRow } from './MergeRisk';
import { ThinkingRow } from './ThinkingRow';

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
  thinking: ThinkingRow,
  progress: ProgressRow,
  author: AuthorRow,
  lanes: LanesRow,
  files: FilesRow,
  collision: CollisionRow,
  member: MemberRow,
  merge_risk: MergeRiskRow,
  lock: LockRow,
};

const GAP: Partial<Record<RowKind, number>> = { call: space.s2, note: space.s4, mod: space.s2, switch: space.s4, prompt: space.s9, member: space.s4, lock: space.s2, files: space.s4 };

export const RowView = memo(function RowView({ row }: { row: ThreadRow }) {
  const Draw = VIEWS[row.kind] as ComponentType<{ row: ThreadRow }>;
  return (
    // A reply's rows sit beside its author's avatar, not under it.
    <View style={{ paddingTop: GAP[row.kind] ?? space.s6, paddingLeft: row.inset ? REPLY_INSET : 0 }}>
      <Draw row={row} />
    </View>
  );
});
