/** The JSON shapes the Conductor and the external MCP server read from /api. Each field is one a tool uses. */

export interface ApiThreadTitle {
  title?: string;
}

export interface ApiFolder {
  id: string;
  name: string;
  channel_id: string;
  count: number;
  running?: number;
  threads?: ApiThreadTitle[];
}

export interface ApiChannel {
  id: string;
  name: string;
  kind: string;
  github_repo: string | null;
  store_domain: string | null;
  running: number;
  notes: string | null;
  folders?: ApiFolder[];
}

export interface ApiRole {
  id: string;
  name: string;
  description: string;
  channel?: string;
}

export interface ApiModel {
  id: string;
  label: string;
  efforts?: readonly string[];
  defaultEffort?: string;
  default?: boolean;
}

export interface ApiHarness {
  id: string;
  name: string;
  plan?: unknown;
  available: boolean;
  fix?: string;
  cap?: unknown;
  running?: number;
  models?: ApiModel[];
}

export interface ApiThread {
  id: string;
  task_id?: string;
  title?: string;
  channel_id: string;
  folder_id?: string | null;
  role?: string;
  harness?: string;
  model?: string;
  effort?: string;
  status: string;
  delegating?: boolean;
  updated_at?: string;
  branch?: string | null;
  pinned_at?: string | null;
  done_at?: string | null;
  auto_reason?: string;
  queued_harness?: string | null;
  queued_model?: string | null;
  queued_effort?: string | null;
}

export interface ApiDevice {
  id: string;
  name: string;
}

export interface ApiQuestion {
  question: string;
}

export interface CrewQuestionItem {
  thread_id: string;
  thread_title: string;
  task_id?: string;
  question: { questions: ApiQuestion[] };
}

export interface ApiArtifactRow {
  url: string;
  name: string;
  description?: string;
  thread_id?: string;
  thread_title?: string;
  channel_id?: string;
  updated_at?: string;
}

export interface ApiAutomationRun {
  thread_id?: string;
  title?: string;
  status?: string;
  trigger?: string;
  created_at?: string;
}

export interface ApiAutomation {
  id: string;
  name: string;
  enabled: boolean;
  channel?: string;
  cron?: string;
  on?: unknown;
  next?: unknown;
  error?: unknown;
  runs?: ApiAutomationRun[];
}

export interface SentSecret {
  id: string;
  scope: string;
  name: string;
  state: string;
  machine: { name: string };
}

export interface ContinueAttachment {
  id: string;
  name: string;
  selected: boolean;
  carried: boolean;
  reason: string | null;
}

export interface ContinuePreview {
  revision: number;
  blocked: { message: string } | null;
  carryover: { attachments: ContinueAttachment[] };
}

export interface SetupBody {
  path: unknown;
  config: { automations?: unknown };
  resolved: unknown;
  env: unknown;
}

export interface ServerOptionsBody {
  options: unknown;
}

export interface AccountBody {
  owner: unknown;
  available: unknown;
}

export interface SignedInDevicesBody {
  devices: unknown;
}

export interface ConnectStatus {
  enabled: boolean;
}

export interface ConnectMachines {
  machines: unknown;
}
