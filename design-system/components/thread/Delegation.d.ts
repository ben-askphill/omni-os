import type { ReactNode } from 'react';

/**
 * Delegation tree inside a Conductor turn. 22px-radius surface card; each crew thread is an 18px-radius white branch
 * card hung off a rounded elbow. Elbow color = state (ultramarine running · vermilion needs · ink done · grey idle).
 * Put an InlineConfirm in `actions` for the decision a needs-you branch is waiting on.
 * @startingPoint section="Thread" subtitle="Conductor fan-out to crew threads" viewport="760x360"
 */
export interface DelegationBranch {
  taskId: string;
  role: 'researcher' | 'builder' | 'store-ops' | 'inbox' | 'conductor';
  title: string;
  channel?: { code?: string; name: string };
  harness?: 'claude-code' | 'codex' | 'cursor';
  state?: 'idle' | 'queued' | 'running' | 'needs' | 'done' | 'settled';
  statusLabel?: string;
  progress?: string;
  note?: ReactNode;
  actions?: ReactNode;
}
export interface DelegationProps {
  title?: string;
  branches?: DelegationBranch[];
  onOpen?: (branch: DelegationBranch) => void;
}
export function Delegation(props: DelegationProps): JSX.Element;
