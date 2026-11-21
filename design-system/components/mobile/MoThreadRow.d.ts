import type { ReactNode } from 'react';

/**
 * MoThreadRow: one row wherever a thread is listed on the phone (ADR 0021, D23). The agent's 36pt avatar, 15pt title,
 * time and the status glyph at the far end, then channel and meta; running progress in live text; diff or artifact
 * count on the right. MoAvatar: the agent's avatar, else the crew mark in a surface-2 disc; nothing sits on it.
 * MoDiff: +add −del, tabular.
 * @startingPoint section="Phone" subtitle="Thread rows: needs, running, done" viewport="860x320"
 */
export type MoState = 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued' | 'failed' | 'stopped';
export type MoRole = 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';

export interface MoThreadRowProps {
  title: string;
  state?: MoState;
  role?: MoRole;
  /** The agent's avatar (AgentAvatar), its eyes on the row's state. */
  avatar?: ReactNode;
  /** Without the #. */
  channel?: string;
  /** Running only, in live text: "step 5/9", "140 of 212". */
  progress?: string;
  meta?: string;
  time?: string;
  diff?: [number, number];
  artifacts?: number;
  /** Drops the hairline under the last row of a list. */
  last?: boolean;
  onPress?: () => void;
  /** Expo only: open the thread menu. */
  onLongPress?: () => void;
}
export function MoThreadRow(props: MoThreadRowProps): JSX.Element;

export interface MoAvatarProps {
  avatar?: ReactNode;
  role?: MoRole;
  size?: number;
}
export function MoAvatar(props: MoAvatarProps): JSX.Element;
export function MoDiff(props: { add: number; del: number }): JSX.Element;
