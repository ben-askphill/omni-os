// Compact row formatters for the four routine lookup tools in apps/mcp/omni.ts (#1011):
// list_harnesses, list_threads, list_automations, and settings.
//
// Each formatter builds on @omni/shared/mcp-compact.ts by also omitting fields sitting at their known default,
// hoisting repeated harness-level model fields (efforts, default_effort, notes), and stripping UI-only prose
// while keeping every id and non-default value an agent needs to act or pass valid arguments to delegate.
import { compactRow } from '@omni/shared/mcp-compact.ts';
import { SETTING_FIELDS } from '@omni/shared/settings.ts';
import { DEFAULT_RETENTION } from '@omni/shared/worktree-cleanup.ts';
import { DEFAULT_SLIM } from '@omni/shared/worktree-slim.ts';

const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** True when every alphanumeric token of `label` already appears in order inside `id` (e.g. "Opus 5.5" in "claude-opus-5-5"). */
export function redundantLabel(id: string, label?: string | null): boolean {
  if (!label) return true;
  const hay = tokens(id);
  const needle = tokens(label);
  if (!needle.length) return true;
  let pos = 0;
  for (const tok of needle) {
    const idx = hay.indexOf(tok, pos);
    if (idx === -1) return false;
    pos = idx + 1;
  }
  return true;
}

/** Trim seconds and milliseconds from ISO UTC ("2026-11-26T08:00:00.000Z" -> "2026-11-26T08:00Z") and SQLite UTC timestamps. */
export function shortTime(value: unknown): string | null | undefined {
  if (typeof value !== 'string') return value as null | undefined;
  return value.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):\d{2}(?:\.\d+)?Z$/, '$1Z').replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\d{2}$/, '$1');
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function mostFrequent<T>(items: readonly T[], keyOf: (item: T) => string): { value: T; count: number } | null {
  const counts = new Map<string, { value: T; count: number }>();
  for (const item of items) {
    const k = keyOf(item);
    const entry = counts.get(k);
    if (entry) entry.count++;
    else counts.set(k, { value: item, count: 1 });
  }
  let best: { value: T; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best;
}

// ---------- list_harnesses ----------

/**
 * Compact `GET /api/harnesses` rows for Conductor tool calls:
 * - Keep `available` (true and false) and the #1006 capability booleans (`steer`, `interrupt`, `tool_limits`, plus `remote: true`); omit `running: 0`.
 * - Omit `name` / model `label` when its tokens already appear in order in `id` (keeps codenames like "GPT-6.1 Sol").
 * - Hoist `efforts` and `default_effort` to the harness when repeated across 2+ models; a model with no efforts keeps `efforts: []` when the harness has a default.
 * - Hoist a single note shared by all models (2+) to harness `note`, or alias any note repeated on 2+ models into harness `notes` (`{"1": "..."}`).
 */
export function compactHarnesses(list: readonly any[]): Record<string, unknown>[] {
  return list.map((h) => {
    const caps = h.capabilities
      ? compactRow(
          { steer: h.capabilities.steer, interrupt: h.capabilities.interrupt, remote: h.capabilities.remote, tool_limits: h.capabilities.toolLimits },
          ['steer', 'interrupt', 'tool_limits'],
        )
      : undefined;

    const rawModels: any[] = Array.isArray(h.models) ? h.models : [];

    // Hoist the most common non-empty efforts list when 2+ models share it.
    const nonEmptyEfforts = rawModels
      .map((m) => (Array.isArray(m.efforts) ? (m.efforts as string[]) : []))
      .filter((e) => e.length > 0);
    const topEfforts = mostFrequent(nonEmptyEfforts, (e) => e.join('\0'));
    const sharedEfforts = topEfforts && topEfforts.count >= 2 ? topEfforts.value : undefined;

    // Hoist the most common non-empty defaultEffort when 2+ models share it.
    const nonEmptyDefaultEfforts = rawModels
      .map((m) => (typeof m.defaultEffort === 'string' && m.defaultEffort ? m.defaultEffort : ''))
      .filter(Boolean);
    const topDefaultEffort = mostFrequent(nonEmptyDefaultEfforts, (e) => e);
    const sharedDefaultEffort = topDefaultEffort && topDefaultEffort.count >= 2 ? topDefaultEffort.value : undefined;

    // Deduplicate repeated per-model notes (e.g. Cursor's Claude billing note, Antigravity's Google AI notes, Cursor Cloud's note).
    const modelNotes = rawModels.map((m) => (typeof m.note === 'string' && m.note.trim() ? m.note.trim() : undefined));
    const allSameNote = rawModels.length >= 2 && modelNotes[0] && modelNotes.every((n) => n === modelNotes[0]) ? modelNotes[0] : undefined;
    const noteCounts = new Map<string, number>();
    if (!allSameNote) {
      for (const n of modelNotes) if (n) noteCounts.set(n, (noteCounts.get(n) ?? 0) + 1);
    }
    const noteAliases = new Map<string, string>();
    const notesDict: Record<string, string> = {};
    let nextNoteId = 1;
    for (const [text, count] of noteCounts) {
      if (count >= 2 && (count - 1) * text.length > 20) {
        const key = String(nextNoteId++);
        noteAliases.set(text, key);
        notesDict[key] = text;
      }
    }

    const models = rawModels.map((m, idx) => {
      const mEfforts: string[] = Array.isArray(m.efforts) ? m.efforts : [];
      const mDefaultEffort = typeof m.defaultEffort === 'string' && m.defaultEffort ? m.defaultEffort : undefined;
      const rawNote = modelNotes[idx];
      const note = allSameNote ? undefined : rawNote ? (noteAliases.get(rawNote) ?? rawNote) : undefined;

      // When a harness-level efforts default exists, a model with no efforts must emit `efforts: []` explicitly.
      const efforts = sharedEfforts
        ? sameList(mEfforts, sharedEfforts)
          ? undefined
          : mEfforts
        : mEfforts.length > 0
          ? mEfforts
          : undefined;
      const keepEfforts = sharedEfforts !== undefined && mEfforts.length === 0;

      const default_effort =
        mDefaultEffort && !(sharedDefaultEffort && mDefaultEffort === sharedDefaultEffort) ? mDefaultEffort : undefined;

      return compactRow(
        {
          id: m.id,
          label: redundantLabel(m.id, m.label) ? undefined : m.label,
          efforts,
          default_effort,
          default: m.default === true ? true : undefined,
          hidden: m.hidden === true ? true : undefined,
          note,
        },
        keepEfforts ? ['efforts'] : undefined,
      );
    });

    return compactRow(
      {
        id: h.id,
        name: redundantLabel(h.id, h.name) ? undefined : h.name,
        plan: h.plan || undefined,
        available: h.available,
        fix: h.available ? undefined : h.fix,
        cap: h.cap ?? undefined,
        running: typeof h.running === 'number' && h.running > 0 ? h.running : undefined,
        capabilities: caps,
        efforts: sharedEfforts,
        default_effort: sharedDefaultEffort,
        note: allSameNote,
        notes: Object.keys(notesDict).length > 0 ? notesDict : undefined,
        models,
      },
      ['available'],
    );
  });
}

// ---------- list_threads ----------

/**
 * Compact `GET /api/threads` rows:
 * - Keep `status` on every row (including `'done'`).
 * - Omit `channel` when it matches the caller's `channel` filter.
 * - Trim `updated_at` to minute precision.
 * - Drop null/false/empty defaults (`role`, `delegating: false`, `task_id`, empty `members`).
 */
export function compactThreads(list: readonly any[], filter: { channel?: string; status?: string } = {}): Record<string, unknown>[] {
  return list.map((t) =>
    compactRow({
      id: t.id,
      title: t.title,
      channel: filter.channel && t.channel_id === filter.channel ? undefined : t.channel_id,
      role: t.role,
      status: t.status,
      delegating: t.delegating,
      task_id: t.task_id,
      updated_at: shortTime(t.updated_at),
      // A group thread's agents (ADR 0019), by name, the lead first.
      ...(t.members?.length && { members: t.members.map((m: { name: string }) => m.name) }),
    }),
  );
}

// ---------- list_automations ----------

const AUTOMATION_PROMPT_CAP = 120;

/**
 * Compact `GET /api/automations` rows:
 * - Keep `enabled` on every row (true and false).
 * - Omit `name` when redundant with `id`, `source: 'own'` (default), and `runs_on` when running on this machine without a `machine:` pin.
 * - Collapse whitespace and cap `prompt` preview at 120 chars (`get_automation` returns the full YAML/prompt).
 * - Trim `next` and `last_runs[].at` to minute precision; omit default `trigger` (`'cron'` or `'event'`) and default `status: 'done'` on each run.
 */
export function compactAutomations(list: readonly any[]): Record<string, unknown>[] {
  return list.map((a) => {
    const cleanPrompt = typeof a.prompt === 'string' ? a.prompt.replace(/\s+/g, ' ').trim() : '';
    const prompt = cleanPrompt.length > AUTOMATION_PROMPT_CAP ? `${cleanPrompt.slice(0, AUTOMATION_PROMPT_CAP)}…` : cleanPrompt;
    const defaultTrigger = a.on ? 'event' : 'cron';
    const runsOn =
      a.runs_on && (!a.runs_on.isThisMac || a.machine)
        ? a.runs_on.isThisMac
          ? 'here'
          : (a.runs_on.owner ?? a.runs_on)
        : undefined;

    return compactRow(
      {
        id: a.id,
        name: redundantLabel(a.id, a.name) ? undefined : a.name,
        enabled: a.enabled,
        ...(a.on ? { on: a.on } : { cron: a.cron, timezone: a.timezone, next: shortTime(a.next) ?? null }),
        channel: a.channel,
        ...(a.machine && { machine: a.machine }),
        ...(runsOn !== undefined && { runs_on: runsOn }),
        ...(a.source && a.source !== 'own' && { source: a.source }),
        ...(a.role && { role: a.role }),
        ...(a.harness && { harness: a.harness }),
        ...(a.model && { model: a.model }),
        ...(a.effort && { effort: a.effort }),
        prompt,
        ...(a.error && { error: a.error }),
        ...(a.poll_error && { poll_error: a.poll_error }),
        last_runs: (a.runs ?? []).slice(0, 3).map((r: any) =>
          compactRow({
            thread_id: r.thread_id,
            trigger: r.trigger && r.trigger !== defaultTrigger ? r.trigger : undefined,
            at: shortTime(r.created_at),
            status: r.status && r.status !== 'done' ? r.status : undefined,
          }),
        ),
      },
      ['enabled'],
    );
  });
}

// ---------- settings ----------

const SECTION_DEFAULTS: Record<string, Record<string, string>> = {};
for (const field of SETTING_FIELDS) {
  (SECTION_DEFAULTS[field.section] ??= {})[field.key] = field.default;
}

function compactSection(section: unknown, defaults: Record<string, string>): Record<string, unknown> | undefined {
  if (!section || typeof section !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    if (key in defaults && value === defaults[key]) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function compactObject(obj: unknown): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Compact the combined `settings` tool payload:
 * - Omit schema `version: 1`, empty strings, and `SETTING_FIELDS` defaults (`pronouns: 'they/them'`, `syncSignatures: 'actions'`).
 * - Omit empty `runOn`, `crew`, `env_overrides`, `usage_panel`, and default worktree retention/slim policies.
 * - Strip UI-only `label`, `hint`, `section` from `server_options` and keep only env-set or non-default options.
 * - Omit false `display` flags and `analytics.configured: false`, while keeping `analytics.enabled` (defaults to true).
 */
export function compactSettings(input: {
  setup: any;
  server: any;
  display: any;
  analytics: any;
  usagePanel: any;
}): Record<string, unknown> {
  const { setup, server, display, analytics, usagePanel } = input;
  const { automations: _automations, ...rawConfig } = setup?.config ?? {};

  const crew: Record<string, unknown> = {};
  if (rawConfig.crew && typeof rawConfig.crew === 'object') {
    for (const [id, override] of Object.entries(rawConfig.crew as Record<string, any>)) {
      if (!override || typeof override !== 'object') continue;
      const compacted = compactRow(override);
      if (Object.keys(compacted).length > 0) crew[id] = compacted;
    }
  }

  const ret = rawConfig.worktrees?.retention;
  const retention =
    ret && (ret.enabled !== DEFAULT_RETENTION.enabled || ret.idleDays !== DEFAULT_RETENTION.idleDays)
      ? { enabled: ret.enabled, idleDays: ret.idleDays }
      : undefined;
  const sl = rawConfig.worktrees?.slim;
  const slim =
    sl && (sl.enabled !== DEFAULT_SLIM.enabled || sl.idleDays !== DEFAULT_SLIM.idleDays)
      ? { enabled: sl.enabled, idleDays: sl.idleDays }
      : undefined;
  const worktrees = retention || slim ? compactRow({ retention, slim }) : undefined;

  const config = compactRow({
    version: rawConfig.version === 1 ? undefined : rawConfig.version,
    onboardedAt: rawConfig.onboardedAt ? shortTime(rawConfig.onboardedAt) : undefined,
    user: compactSection(rawConfig.user, SECTION_DEFAULTS.user ?? {}),
    workspace: compactSection(rawConfig.workspace, SECTION_DEFAULTS.workspace ?? {}),
    integrations: compactSection(rawConfig.integrations, SECTION_DEFAULTS.integrations ?? {}),
    runOn: rawConfig.runOn?.device ? { device: rawConfig.runOn.device } : undefined,
    crew: Object.keys(crew).length > 0 ? crew : undefined,
    worktrees,
  });

  const resolved = compactObject(setup?.resolved);
  const envOverrides = compactObject(setup?.env);

  const serverOptions = Array.isArray(server?.options)
    ? server.options
        .filter((o: any) => o.source !== 'default' || o.value !== o.default)
        .map((o: any) => compactRow({ env: o.env, value: o.value, default: o.value !== o.default ? o.default : undefined }))
    : [];

  const displayCompact = display && typeof display === 'object' ? compactRow(display) : undefined;
  // analytics.enabled defaults to true, so keep it (true and false) while dropping configured: false.
  const analyticsCompact =
    analytics && typeof analytics === 'object'
      ? compactRow({ enabled: analytics.enabled, configured: analytics.configured }, ['enabled'])
      : undefined;

  const usagePanelCompact =
    usagePanel && typeof usagePanel === 'object'
      ? compactRow({
          order: Array.isArray(usagePanel.order) && usagePanel.order.length > 0 ? usagePanel.order : undefined,
          visible: usagePanel.visible && Object.keys(usagePanel.visible).length > 0 ? usagePanel.visible : undefined,
        })
      : undefined;

  return compactRow({
    path: setup?.path,
    config: Object.keys(config).length > 0 ? config : undefined,
    resolved,
    env_overrides: envOverrides,
    server_options: serverOptions.length > 0 ? serverOptions : undefined,
    display: displayCompact && Object.keys(displayCompact).length > 0 ? displayCompact : undefined,
    analytics: analyticsCompact && Object.keys(analyticsCompact).length > 0 ? analyticsCompact : undefined,
    usage_panel: usagePanelCompact && Object.keys(usagePanelCompact).length > 0 ? usagePanelCompact : undefined,
  });
}
