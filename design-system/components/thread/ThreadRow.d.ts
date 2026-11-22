import type { ReactNode } from 'react';

/**
 * Thread row (web/src ThreadList.tsx, ADR 0021 D23). 18px-radius row with a Bencho hover wash; the agent's 32px avatar
 * leads it (`avatar`, an AgentAvatar showing the row's state in its eyes), else the channel's Monogram for a thread with
 * no agent; line 1: 14px title, flags/chips, mono time and the 8px status dot at the far end; line 2: harness, branch
 * pill, preview, T-id. Idle rows drop to regular weight in fg-2. Compact density hides line 2.
 * @startingPoint section="Thread" subtitle="Thread list row + day group" viewport="760x320"
 */
export interface ThreadRowProps {
  title: string;
  taskId?: string;
  state?: 'idle' | 'settled' | 'queued' | 'running' | 'needs' | 'done' | 'failed';
  harness?: 'claude-code' | 'codex' | 'cursor';
  /** Crew role shown as a chip */
  role?: string;
  crew?: string;
  source?: string;
  time?: string;
  branch?: string;
  meta?: string;
  preview?: string;
  /**
   * The agent's avatar (AgentAvatar, 32px), its eyes on the row's state. Leave it out for a thread with no agent: the
   * channel's Monogram leads instead. A group thread whose agents work or wait on you passes their faces (the avatar mark).
   */
  avatar?: ReactNode;
  /** Show #name on line 2 (cross-channel lists); its Monogram leads a thread with no agent. */
  channel?: string;
  /** The channel a single channel's list shows, for its Monogram when the thread has no agent. */
  home?: string;
  /**
   * Ben marked it done: out of Needs you, still listed in its channel. A grey check replaces the status dot, the
   * title goes fg-4 and an outline Done chip shows, whatever `state` is.
   */
  markedDone?: boolean;
  selected?: boolean;
  onClick?: () => void;
}
export function ThreadRow(props: ThreadRowProps): JSX.Element;

/** A day group: sticky caption label + count, rows rise in with a 28ms stagger. */
export interface ThreadGroupProps { label: string; count?: number; children?: ReactNode }
export function ThreadGroup(props: ThreadGroupProps): JSX.Element;
