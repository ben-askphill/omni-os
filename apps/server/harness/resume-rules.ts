// What a resumed chat reads again when its harness takes Omni's system prompt only as a new chat's first message
// (local Cursor, harness/cursor/adapter.ts). Claude Code and Codex get the whole prompt on every resume. A chat made
// before Omni changed one of these rules would otherwise keep the old one: the tool-failure policy, and the Reply block
// (runner/prompts.ts replyBlock), which says when an answer is a page and what stays text.
import { TOOL_FAILURE_POLICY } from '../tool-failure-policy.ts';

/** Said under the Reply heading, so the resent rules win over the copy the chat started with. */
export const RESENT_REPLY = 'These are the current reply rules. They replace any older version earlier in this chat.';

/** The rules a resumed chat gets in front of its first input. `reply` is the thread's Reply block, heading first. */
export function resumeRules(reply: readonly string[] = []): string {
  if (!reply.length) return TOOL_FAILURE_POLICY;
  const [heading, ...rest] = reply;
  return [TOOL_FAILURE_POLICY, '', heading, RESENT_REPLY, ...rest].join('\n');
}
