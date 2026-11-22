import type { MonthlyPlanUsage, PlanUsage, PlanWindow } from '@omni/shared/account-usage.ts';
import { apiPath, type HttpClient } from '../http.ts';
import type { HarnessId } from './harnesses.ts';
import type { Thread, ThreadStub } from './threads.ts';

export type UsageWindow = PlanWindow;
export type MonthlyUsage = MonthlyPlanUsage;
export type Usage = PlanUsage;

export type HarnessUsage = Partial<Record<HarnessId, Usage | null>>;

/** A thread in the Pinned list, the latest pin first. */
export type PinnedThread = ThreadStub & { pinned_at: string | null };

/** The part of GET /status the phone reads: plan usage for Activity, and the machine the server runs on for the machine picker. */
export interface ServerStatus {
  usage: HarnessUsage;
  slots?: Partial<Record<HarnessId, { running: number; cap: number }>>;
  /** The machine the server runs on, under its own name. `here`: the client reaches it directly, not through another device. Older servers leave it out. */
  device?: { name: string; here: boolean };
  /** The largest file the server accepts, in megabytes. Older servers leave it out. */
  maxUploadMb?: number;
  /** A Grok Bot webhook is set on this server, so Send to Grok Bot works. Older servers leave it out. */
  grokBot?: boolean;
  /** Which server this is: its version, commit and start time. */
  server?: { version: string; gitHead: string | null; startedAt: string; secretStore?: string };
}

export function activityApi(http: HttpClient) {
  return {
    /** The latest threads in any channel, newest activity first. */
    recent: (limit = 60) => http.request<Thread[]>('GET', apiPath`/recent`, { query: { limit } }),
    /** Pinned threads in every channel, the latest pin first. Archived ones drop out. */
    pinned: () => http.request<PinnedThread[]>('GET', apiPath`/pinned`),
    status: () => http.request<ServerStatus>('GET', apiPath`/status`),
  };
}
