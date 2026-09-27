// What the reply composer does with a `/`, as pure functions: the Omni commands every thread's menu
// offers, what Send does with a message that starts with one, and the quiet hints for commands that
// stay plain text. The grammar itself is in shared/slash.ts.
import { OMNI_COMMANDS, mentionHits, midMessageCommands, resolveSlash, type SlashCommand } from '../../shared/slash.ts';
import type { CommandList, Thread } from './api.ts';

const HARNESS_NAME: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };
export const harnessName = (id: string) => HARNESS_NAME[id] ?? id;

/** A thread's menu: its harness's list, then Omni's own commands, which work on every harness. */
export const menuCommands = (list: SlashCommand[] | undefined): SlashCommand[] => [...(list ?? []), ...OMNI_COMMANDS];

export type ReplyAction =
  /** To the harness, as typed. */
  | { kind: 'send' }
  /** `/clear` or `/new`: a new thread with this one's settings. No prompt opens its composer. */
  | { kind: 'new-thread'; prompt: string }
  | { kind: 'rename'; title: string }
  /** `/model`, `/effort` or `/fast`, which a thread can't change. */
  | { kind: 'fixed' };

export interface ReplySlash {
  action: ReplyAction;
  /** Whether Send does anything. */
  armed: boolean;
  /** The Send button's label when Send runs an Omni command. */
  label: string | null;
  /** One quiet line under the composer. */
  hint: string | null;
}

/** What Send does with the composer's text, against the thread's command list. */
export function replySlash(text: string, list: CommandList | null, harness: string): ReplySlash {
  const r = resolveSlash(text, list?.commands ?? []);
  if (r?.kind === 'omni') {
    const args = r.token.args.trim();
    switch (r.name.toLowerCase()) {
      case 'clear':
      case 'new':
        return {
          action: { kind: 'new-thread', prompt: args },
          armed: true,
          label: 'New thread',
          hint: args ? 'Starts a new thread with this prompt and the same settings. This one stays as it is.' : 'Opens a new thread with the same settings.',
        };
      case 'rename': {
        const title = args.replace(/\s+/g, ' ');
        return { action: { kind: 'rename', title }, armed: !!title, label: 'Rename', hint: title ? null : 'Type the new title after /rename.' };
      }
      default:
        return { action: { kind: 'fixed' }, armed: false, label: null, hint: 'The model, effort and fast mode are fixed per thread.' };
    }
  }
  return { action: { kind: 'send' }, armed: !!text.trim(), label: null, hint: textHint(text, r, list, harness) };
}

/**
 * Why a `/name` in a message that sends as typed won't run, or might not: Claude Code leaves a
 * Mention to the model. None of these stops the send.
 */
function textHint(text: string, r: ReturnType<typeof resolveSlash>, list: CommandList | null, harness: string): string | null {
  if (r?.kind === 'terminal') return `/${r.name} only works in a ${harnessName(harness)} terminal, so it sends as text.`;
  // Until the list is in, any name could be one of the thread's commands.
  if (r?.kind === 'unknown' && list?.status === 'ready') return `No /${r.name} command in this thread, so it sends as text.`;
  const [late] = midMessageCommands(text, list?.commands ?? []);
  if (late) return `/${late.name} only works at the start of a message, so here it stays text.`;
  if (harness !== 'claude-code') return null;
  const hits = mentionHits(text, list?.commands ?? []);
  // Each command once, as Ben first typed it.
  const typed = hits.filter((h, i) => hits.findIndex((o) => o.name === h.name) === i).map((h) => text.slice(h.start, h.end));
  return typed.length ? `Claude Code loads ${and(typed)} only if the model decides to.` : null;
}

/** "a", "a and b", "a, b and c". */
const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** The body that starts a thread with this one's channel, harness, model, effort and role. */
export const newThreadBody = (t: Thread, prompt: string) => ({
  channel: t.channel_id,
  prompt,
  role: t.role || undefined,
  harness: t.harness,
  model: t.model || undefined,
  effort: t.effort || undefined,
});

/** What the new-thread composer starts with when it opens from a thread. */
export interface NewThreadPreset {
  channel: string;
  /** A crew role's id, or '' for none. */
  role: string;
  choice?: { harness: string; model: string };
  effort?: string;
  /** Open the model picker. */
  pickModel?: boolean;
}

/** `/clear` or `/new` on its own: this thread's settings, for a first prompt Ben types next. */
export const sameSettings = (t: Thread): NewThreadPreset => ({
  channel: t.channel_id,
  role: t.role ?? '',
  choice: { harness: t.harness, model: t.model ?? '' },
  effort: t.effort,
});

/** "New thread on another model": the channel and role, and nothing that picks a model. */
export const otherModel = (t: Thread): NewThreadPreset => ({ channel: t.channel_id, role: t.role ?? '', pickModel: true });
