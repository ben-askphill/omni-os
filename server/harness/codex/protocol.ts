// The subset of the `codex app-server` JSON-RPC protocol Omni depends on, copied from
// codex-cli 0.157's generated bindings (`codex app-server generate-ts --out <dir>`, the
// v2 folder). The fake app-server in tests/ speaks these shapes, so they pin nothing
// about a real Codex: after a `brew upgrade`, regenerate the bindings, diff them against
// this file, and run `OMNI_LIVE_CODEX=1 npm test` (tests/codex-live.test.ts).

/** JSON-RPC request/response envelopes over stdio, one JSON object per line. */
export interface RpcRequest {
  id: number;
  method: string;
  params?: unknown;
}
export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}
export interface RpcNotification {
  method: string;
  params?: unknown;
}

/** A codex conversation item. `type` is the discriminant. Only the fields Omni reads are typed. */
export interface CodexItem {
  id: string;
  type:
    | 'userMessage'
    | 'agentMessage'
    | 'reasoning'
    | 'commandExecution'
    | 'fileChange'
    | 'mcpToolCall'
    | 'webSearch'
    | 'plan'
    | 'imageView'
    | 'dynamicToolCall'
    | 'collabAgentToolCall'
    | 'contextCompaction'
    | string;
  [k: string]: unknown;
}

export interface CommandExecutionItem extends CodexItem {
  type: 'commandExecution';
  command: string | string[];
  aggregatedOutput?: string;
  output?: string;
  exitCode?: number;
}

export interface AgentMessageItem extends CodexItem {
  type: 'agentMessage';
  text: string;
}

// ---------- the catalog probe ----------
// account/read, config/read and model/list reject a request without `params`; send `{}`.

/** account/read. `account` is null when Codex is not logged in. */
export interface GetAccountResponse {
  account: { type: 'chatgpt'; email: string | null; planType: string } | { type: 'apiKey' } | { type: 'amazonBedrock' } | null;
  requiresOpenaiAuth: boolean;
}

/** config/read: the effective config.toml, keys as written there. */
export interface ConfigReadResponse {
  config: { model: string | null; model_reasoning_effort: string | null };
}

/** One model in model/list. `isDefault` is Codex's own default, before config.toml's `model`. */
export interface CodexModel {
  id: string;
  displayName: string;
  hidden: boolean;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string;
  isDefault: boolean;
}

/** model/list, one page. */
export interface ModelListResponse {
  data: CodexModel[];
  nextCursor: string | null;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null; // epoch seconds
}
/** One rate-limit bucket. account/rateLimits/updated sends one at a time, and sparse: a null window is unchanged. */
export interface RateLimits {
  limitId: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
}

/** account/rateLimits/read: `rateLimits` is the older single-bucket view; the plan's is `rateLimitsByLimitId.codex`. */
export interface GetAccountRateLimitsResponse {
  rateLimits: RateLimits;
  rateLimitsByLimitId: { [limitId: string]: RateLimits | undefined } | null;
}

// ---------- threads and turns ----------

/** thread/start and thread/resume answer with the whole thread; the Codex thread id is `thread.id`. */
export interface ThreadStartResponse {
  thread: { id: string };
  model: string;
}

/** A turn, as turn/start answers with it and turn/started and turn/completed carry it. */
export interface CodexTurn {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: TurnError | null;
}

/** The API's error, often its JSON response body as a string. */
export interface TurnError {
  message: string;
}

/** The `error` notification. With `willRetry` false, a turn/completed with status "failed" follows. */
export interface ErrorNotification {
  error: TurnError;
  willRetry: boolean;
  threadId: string;
  turnId: string;
}

/** turn/plan/updated: the agent's checklist, sent whole on every change. */
export interface PlanUpdate {
  explanation: string | null;
  plan: { step: string; status: 'pending' | 'inProgress' | 'completed' }[];
}

/** Turn input items sent on turn/start and turn/steer. */
export type CodexInput =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'localImage'; path: string }
  | { type: 'image'; url: string };
