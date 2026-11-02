import { apiPath, type HttpClient } from '../http.ts';
import type { HarnessId } from './harnesses.ts';
import type { Thread, ThreadStub } from './threads.ts';

/** A plan usage window. `utilization` is a 0 to 1 fraction from some harnesses and a 0 to 100 percent from others. */
export interface UsageWindow {
  utilization: number;
  resetsAt: number;
}

/** A monthly billing cycle (Cursor's). Fractions are 0 to 1, money in cents. */
export interface MonthlyUsage extends UsageWindow {
  startsAt?: number;
  auto?: number;
  api?: number;
  spendCents?: number;
  includedCents?: number;
  bonusCents?: number;
}

export interface Usage {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  monthly?: MonthlyUsage;
  status?: string;
  updated_at?: string;
}

export type HarnessUsage = Partial<Record<HarnessId, Usage | null>>;

/** A thread in the Pinned list, the latest pin first. */
export type PinnedThread = ThreadStub & { pinned_at: string | null };

/** The part of GET /status the phone reads: plan usage for Activity, and the machine the server runs on for the machine picker. */
export interface ServerStatus {
  usage: HarnessUsage;
  /** The machine the server runs on, under its own name. `here`: the client reaches it directly, not through another device. Older servers leave it out. */
  device?: { name: string; here: boolean };
  /** The largest file the server accepts, in megabytes. Older servers leave it out. */
  maxUploadMb?: number;
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
