// What a resumed chat reads again when its harness takes Omni's system prompt only as a new chat's first message
// (local Cursor, harness/cursor/adapter.ts). Claude Code and Codex get the whole prompt on every resume. A chat made
// before Omni changed one of these rules would otherwise keep the old one: the tool-failure policy, and the Reply block
// (runner/prompts.ts replyLines), which says when an answer is a page and what stays text.
import { TOOL_FAILURE_POLICY } from '../tool-failure-policy.ts';

/** Said under the Reply heading, so the resent rules win over the copy the chat started with. */
export const RESENT_REPLY = 'These are the current reply rules. They replace any older version earlier in this chat.';

/** The `## Reply` section of a system prompt runner/prompts.ts built, up to the next section, or '' without one. */
export function replySection(systemPrompt: string): string {
  const line = systemPrompt.indexOf('\n## Reply\n');
  const at = systemPrompt.startsWith('## Reply\n') ? 0 : line < 0 ? -1 : line + 1;
  if (at < 0) return '';
  const end = systemPrompt.indexOf('\n\n## ', at);
  return systemPrompt.slice(at, end < 0 ? undefined : end).trimEnd();
}

/** The rules a resumed chat gets in front of its first input. */
export function resumeRules(systemPrompt: string): string {
  const reply = replySection(systemPrompt);
  if (!reply) return TOOL_FAILURE_POLICY;
  const [heading, ...rest] = reply.split('\n');
  return [TOOL_FAILURE_POLICY, '', heading, RESENT_REPLY, ...rest].join('\n');
}
