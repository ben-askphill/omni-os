// What a resumed chat reads again when its harness takes Omni's system prompt only as a new chat's first message
// (local Cursor, harness/cursor/adapter.ts, and Antigravity and OpenCode, which have no system prompt field over ACP). Claude Code and Codex get
// the whole prompt on every resume. A chat made before Omni changed the Reply block (runner/prompts.ts replyBlock),
// which says when an answer is a page and what stays text, would otherwise keep the old one. The tool-failure policy
// is not sent again: the chat has it from its first message, and resending it cost every resume ~500 tokens (#1013).
// The Reply block goes once per change too: the thread keeps a fingerprint of the rules its chat last read, and a
// resume sends them only when they changed since (#1015). Resent on every resume, it cost ~2.1K characters each.
import { createHash } from 'node:crypto';

/** Said under the Reply heading, so the resent rules win over the copy the chat started with. */
export const RESENT_REPLY = 'These are the current reply rules. They replace any older version earlier in this chat.';

/** The rules a resumed chat gets in front of its first input, or '' for none. `reply` is the thread's Reply block, heading first. */
export function resumeRules(reply: readonly string[] = []): string {
  if (!reply.length) return '';
  const [heading, ...rest] = reply;
  return [heading, RESENT_REPLY, ...rest].join('\n');
}

/** Where a thread keeps the fingerprint of the rules its chat last read (runner/prompts.ts threadChatRules: kv). */
export interface RulesMark {
  get(): string | undefined;
  set(fingerprint: string): void;
}

/** A thread's resume rules, as an adapter uses them (AdapterContext.chatRules). */
export interface ChatRules {
  /** What a resumed chat's first input carries in front: the rules, or '' when the chat already read these. */
  resend(): string;
  /** The chat now has the rules: a new chat's first message carried the whole prompt, or a resume sent them. */
  sent(): void;
}

const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** `text` is what a resume would send (resumeRules); `mark` keeps what the chat last read. */
export function chatRules(text: string, mark: RulesMark): ChatRules {
  const print = fingerprint(text);
  return {
    resend: () => (text && mark.get() !== print ? text : ''),
    sent: () => {
      if (text && mark.get() !== print) mark.set(print);
    },
  };
}
