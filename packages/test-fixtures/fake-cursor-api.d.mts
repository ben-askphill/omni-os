// Types for fake-cursor-api.mjs, so TypeScript tests can import it.
export interface FakeCursorCall {
  method: string;
  path: string;
  body: unknown;
  /** How the key came: never its value. */
  auth: 'bearer' | 'basic' | null;
}

export interface FakeCursorApi {
  url: string;
  calls: FakeCursorCall[];
  agents: Map<string, unknown>;
  runs: Map<string, unknown>;
  reset(): void;
  close(): Promise<void>;
}

export function startFakeCursorApi(opts?: { port?: number }): Promise<FakeCursorApi>;
