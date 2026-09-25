// The subset of the `codex app-server` JSON-RPC protocol Omni depends on, modeled on
// the 0.157 TypeScript bindings (`codex app-server generate-ts`). The contract tests
// pin these shapes; a Codex upgrade that changes them should fail there first.

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

/** A single reasoning-effort level a model supports. */
export interface CodexModel {
  id: string;
  displayName?: string;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
}

export interface RateLimitWindow {
  usedPercent: number;
  resetsAt: number; // epoch seconds
  windowMinutes?: number;
}
export interface RateLimits {
  id?: string;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
}

/** Turn input items sent on turn/start and turn/steer. */
export type CodexInput =
  | { type: 'text'; text: string }
  | { type: 'localImage'; path: string }
  | { type: 'image'; url: string };
