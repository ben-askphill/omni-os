import type { Clipped } from '@omni/shared/history.ts';

export interface EventRow {
  id: number;
  thread_id: string;
  kind: string;
  /** JSON text. */
  payload: string;
  created_at: string;
}

/** A row of a history page. A clipped one comes whole from `api.event`. */
export type HistoryEvent = EventRow & { clipped?: Clipped };

export interface Artifact {
  id: number;
  thread_id: string;
  path: string;
  name: string;
  kind: string;
  size: number;
  url: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModStatus {
  thread_id: string;
  channel_id: string;
  plugin: string;
  text: string;
  updated_at: string;
}
