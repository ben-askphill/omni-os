/**
 * MoThreadRow: one row wherever a thread is listed on the phone. 36pt crew avatar with the status glyph, 15pt title,
 * time, then channel and meta; running progress in live text; diff or artifact count on the right.
 * MoAvatar: crew mark in a surface-2 disc with the status glyph on its corner. MoDiff: +add −del, tabular.
 * @startingPoint section="Phone" subtitle="Thread rows: needs, running, done" viewport="860x320"
 */
export type MoState = 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued' | 'failed' | 'stopped';
export type MoRole = 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';

export interface MoThreadRowProps {
  title: string;
  state?: MoState;
  role?: MoRole;
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
  role?: MoRole;
  state?: MoState;
  size?: number;
}
export function MoAvatar(props: MoAvatarProps): JSX.Element;
export function MoDiff(props: { add: number; del: number }): JSX.Element;
