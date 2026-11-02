import { apiPath, type HttpClient } from '../http.ts';

export type HarnessId = 'claude-code' | 'codex' | 'cursor' | 'hermes' | 'cursor-cloud';

export interface HarnessCapabilities {
  /** The process stays warm between turns. */
  warmProcess: boolean;
  /** Steer mid-turn. When false, a steer request is handled as a queue. */
  steer: boolean;
  /** Stop a turn on request and stay up. */
  interrupt: boolean;
  /** Images ride along inline. When false, attachments go as path notes only. */
  inlineImages: boolean;
  /** Which plan usage windows the harness reports. */
  usage: 'five-hour-week' | 'monthly' | 'none';
}

/** One model a harness offers. */
export interface ModelEntry {
  /** The id `switchRun` and `createThread` take. */
  id: string;
  label: string;
  note?: string;
  /** Reasoning effort levels the model supports. Empty: it has none. */
  efforts: string[];
  /** The effort used when none is picked. Empty when the model has no levels. */
  defaultEffort: string;
  default?: boolean;
}

/** GET /harnesses: a harness with its availability, models and cap. */
export interface HarnessInfo {
  id: HarnessId;
  name: string;
  /** The plan that bills, e.g. "Claude plan". */
  plan: string;
  capabilities: HarnessCapabilities;
  /** Installed and logged in. When false it can't be used. */
  available: boolean;
  /** The command that fixes availability, e.g. "codex login". Present when unavailable. */
  fix?: string;
  models: ModelEntry[];
  /** Concurrency cap. */
  cap: number;
  /** Threads running on it now. */
  running: number;
  /** How to install the CLI, when it can be installed. */
  install?: string;
}

/**
 * Whether a follow-up on a busy thread can steer, or has to queue. The catalog is `GET /harnesses`. While it has not
 * loaded, or has no row for this harness, every harness but Cursor and Cursor Cloud steers.
 */
export function canSteer(harnessId: string, catalog: readonly Pick<HarnessInfo, 'id' | 'capabilities'>[] | null | undefined): boolean {
  const row = catalog?.find((h) => h.id === harnessId);
  if (row) return row.capabilities.steer;
  return harnessId !== 'cursor' && harnessId !== 'cursor-cloud';
}

export function harnessesApi(http: HttpClient) {
  return {
    /** With a channel, as that channel sees them: Cursor Cloud needs its GitHub repo. The server probes a harness that is down first. */
    harnesses: (channel?: string) => http.request<HarnessInfo[]>('GET', apiPath`/harnesses`, { query: { channel } }),
  };
}
