import { createHash } from 'node:crypto';
import { db, tx } from './db.ts';
import type { Record as StreamRecord } from './stream.ts';

export const FAILURE_CATEGORIES = ['authentication', 'permission', 'rate_limit', 'timeout', 'unavailable', 'invalid_input', 'not_found', 'command_exit', 'unknown'] as const;
export const FAILURE_STATUSES = ['open', 'investigating', 'fixed', 'avoid', 'replacement'] as const;
export type FailureCategory = typeof FAILURE_CATEGORIES[number];

// Persist only allowlisted summaries. Regex redaction cannot safely preserve arbitrary error text:
// tool output can contain customer records, source files, credentials and entire request bodies.
const DETAILS: Record<FailureCategory, string> = {
  authentication: 'Authentication failed.', permission: 'Permission denied.', rate_limit: 'Rate limit reached.',
  timeout: 'Tool timed out.', unavailable: 'Service or connection unavailable.', invalid_input: 'Invalid tool input.',
  not_found: 'Requested resource not found.', command_exit: 'Command returned a nonzero exit code.', unknown: 'Tool reported failure; raw details omitted.',
};
// The exit codes a shell gives a command it could not run, and GNU timeout's own.
const EXIT_CATEGORIES: Partial<Record<string, FailureCategory>> = { 124: 'timeout', 126: 'permission', 127: 'not_found' };

export function classifyFailure(text: string): FailureCategory {
  // Every harness reports a failed shell call as "Exit code N" then the command's own output. That output
  // (test logs, file contents) mentions timeouts, 404s or "unavailable" for reasons unrelated to the failure,
  // so only the exit code and a missing-command notice count. A test named "times out" or a log line saying
  // "unavailable" says nothing about the tool.
  const exit = /^Exit code (\d+)/.exec(text);
  if (exit) {
    const known = EXIT_CATEGORIES[exit[1]];
    if (known) return known;
    if (/command not found/.test(text.split('\n').slice(1, 3).join('\n'))) return 'not_found';
    return 'command_exit';
  }
  // Claude Code's reply when Ben declines or interrupts a call.
  if (text.startsWith("The user doesn't want to proceed with this tool use")) return 'permission';
  if (/\b(401|unauthorized|unauthenticated|authentication|invalid.api.key)\b/i.test(text)) return 'authentication';
  if (/\b(403|forbidden|permission denied|access denied|EACCES|EPERM)\b/i.test(text)) return 'permission';
  if (/\b(429|rate.limit|quota.exceeded)\b/i.test(text)) return 'rate_limit';
  if (/\b(timed? ?out|timeout|ETIMEDOUT)\b/i.test(text)) return 'timeout';
  if (/\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|unavailable|502|503|504)\b/i.test(text)) return 'unavailable';
  if (/\b(invalid (input|argument|parameter)|validation|schema)\b/i.test(text)) return 'invalid_input';
  if (/\b(404|ENOENT|not found|no such file)\b/i.test(text)) return 'not_found';
  if (/\b(exit (code|status)|non.?zero)\b/i.test(text)) return 'command_exit';
  return 'unknown';
}

// References and tool names are metadata, not a second route for storing arbitrary payloads.
const ref = (s: string) => /^[a-zA-Z0-9_.:/-]{1,200}$/.test(s) ? s : 'unknown';
const loggerTool = (name: string) => /(?:^|__)(?:tool_failures|triage_tool_failure|report_tool_failure|note_tool_failure_recovery)$/.test(name);
const digest = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** Human-written remediation only. Raw tool errors never pass through this filter. */
export function safeGuidance(text: string): string {
  let safe = text;
  for (const [key, value] of Object.entries(process.env)) {
    if (/(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL)/i.test(key) && value && value.length >= 4) safe = safe.split(value).join('[redacted]');
  }
  return safe.replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[redacted]')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]+|gh[pousr]_[a-zA-Z0-9_]+|github_pat_[a-zA-Z0-9_]+)\b/g, '[redacted]')
    .replace(/\b(?:password|token|secret|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[link omitted]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email omitted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1000);
}

export interface FailureInput {
  thread_id: string; channel_id: string; harness: string; session_id: string; call_id: string;
  tool: string; category: FailureCategory; event_id?: number; parent_call_id?: string | null;
}

export const toolFailures = {
  record(input: FailureInput) {
    if (loggerTool(input.tool)) return null;
    const tool = ref(input.tool), call = ref(input.call_id), session = ref(input.session_id);
    // A missing call id cannot be safely matched to another result. Use the event ref instead.
    const id = digest([input.thread_id, input.harness, session, call === 'unknown' || !input.call_id ? input.event_id ?? 'manual' : call]);
    const group = digest([input.harness, tool, input.category]);
    return tx(() => {
      const ts = new Date().toISOString();
      const added = db.prepare(`INSERT OR IGNORE INTO tool_failures
        (id, group_id, thread_id, channel_id, harness, session_id, call_id, tool, category, detail, event_id, parent_call_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, group, ref(input.thread_id), ref(input.channel_id), ref(input.harness), session, call, tool,
        input.category, DETAILS[input.category], input.event_id ?? null, input.parent_call_id ? ref(input.parent_call_id) : null, ts,
      );
      if (added.changes) db.prepare(`INSERT INTO tool_failure_triage (group_id, status, guidance, updated_at)
        VALUES (?, 'open', '', ?) ON CONFLICT(group_id) DO UPDATE SET
        status = CASE WHEN status = 'fixed' THEN 'open' ELSE status END, updated_at = excluded.updated_at`).run(group, ts);
      return { id, group_id: group, added: !!added.changes };
    });
  },
  groups(status?: string) {
    return db.prepare(`SELECT f.group_id, f.harness, f.tool, f.category, f.detail,
      COUNT(*) AS occurrences, MIN(f.created_at) AS first_seen, MAX(f.created_at) AS last_seen,
      t.status, t.guidance, t.updated_at FROM tool_failures f JOIN tool_failure_triage t USING (group_id)
      WHERE (? IS NULL OR t.status = ?) GROUP BY f.group_id ORDER BY occurrences DESC, last_seen DESC LIMIT 200`).all(status ?? null, status ?? null);
  },
  occurrences(group: string, before = Number.MAX_SAFE_INTEGER) {
    return db.prepare(`SELECT rowid AS cursor, * FROM tool_failures WHERE group_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT 100`).all(group, before);
  },
  triage(group: string, status: string, guidance: string) {
    return !!db.prepare('UPDATE tool_failure_triage SET status = ?, guidance = ?, updated_at = ? WHERE group_id = ?')
      .run(status, safeGuidance(guidance), new Date().toISOString(), group).changes;
  },
  context(id: string, recovery: 'recovered' | 'not_recovered' | 'unknown', retryOf?: string) {
    // Explicit observations only. The success of another call is not evidence of recovery.
    if (retryOf && !db.prepare('SELECT id FROM tool_failures WHERE id = ?').get(retryOf)) return false;
    return !!db.prepare('UPDATE tool_failures SET recovery = ?, retry_of = ? WHERE id = ?')
      .run(recovery, retryOf ?? null, id).changes;
  },
};

/** Failure capture must never interrupt a tool result or recursively log its own failure. */
export function observeToolResult(context: Omit<FailureInput, 'tool' | 'category' | 'call_id' | 'parent_call_id'>,
  result: Extract<StreamRecord, { kind: 'tool_result' }>['payload'], use: { name: string; parent?: string | null } | null) {
  if (!result.is_error) return;
  try {
    toolFailures.record({ ...context, call_id: result.tool_use_id, tool: use?.name ?? 'unknown',
      parent_call_id: use?.parent, category: classifyFailure(result.text) });
  } catch {
    // Fixed text only: an exception may contain SQL, paths or a sensitive tool result.
    console.error('[tool-failures] capture failed; tool result delivery continues');
  }
}
