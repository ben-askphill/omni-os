// What the composers do with a `/`, as pure functions: the Omni commands every thread's menu offers,
// what Send does with a message that starts with one, and the quiet hints for commands that stay
// plain text. The new-thread composer offers no Omni commands. The grammar itself is in slash.ts.
// Every client uses it: the Web UI on desktop and phone, and the iOS app.
import { OMNI_COMMANDS, TITLE_MAX, mentionHits, midMessageCommands, resolveSlash, visibleCommands, type CommandList, type SlashCommand } from './slash.ts';
import { mentionSections, menuSections, slashQuery, type MenuSection, type SlashQuery } from './slash-menu.ts';
import type { DraftRun } from './draft-run.ts';
import { AUTO, AUTO_CHOICE } from './thread-run.ts';

const HARNESS_NAME: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', hermes: 'Hermes', 'cursor-cloud': 'Cursor Cloud', antigravity: 'Antigravity' };
export const harnessName = (id: string) => HARNESS_NAME[id] ?? id;

/**
 * A composer's menu: its harness's list, less the built-ins Omni runs in their place. A thread's
 * reply box adds Omni's own commands, which work on every harness.
 */
export const menuCommands = (list: SlashCommand[] | undefined, where: 'reply' | 'new-thread'): SlashCommand[] => [
  ...visibleCommands(list ?? []),
  ...(where === 'reply' ? OMNI_COMMANDS : []),
];

/**
 * The `/` menu at the caret, for a composer that reads the caret itself (the iOS app's; the Web UI's editor finds the
 * `/` with its trigger menu): the command being typed and the rows for it. Null when no command is being typed.
 */
export function commandMenu(text: string, caret: number, list: CommandList | null, where: 'reply' | 'new-thread'): { at: SlashQuery; sections: MenuSection[] } | null {
  const at = slashQuery(text, caret);
  if (!at) return null;
  const rows = at.mention ? mentionSections : menuSections;
  return { at, sections: rows(menuCommands(list?.commands, where), at.query, list?.recent) };
}

export type ReplyAction =
  /** To the harness, as typed. */
  | { kind: 'send' }
  /** `/clear` or `/new`: a new thread with this one's settings. No prompt opens its composer. */
  | { kind: 'new-thread'; prompt: string }
  | { kind: 'rename'; title: string }
  /** `/model`, `/effort` or `/fast`: Send opens the composer's model pill. Its pick switches the next turn. */
  | { kind: 'pick-model' };

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
    switch (r.command.name) {
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
        const hint = !title
          ? 'Type the new title after /rename.'
          : title.length > TITLE_MAX
            ? `A title can be up to ${TITLE_MAX} characters. This one is ${title.length}.`
            : null;
        return { action: { kind: 'rename', title }, armed: !!title && !hint, label: 'Rename', hint };
      }
      default:
        return { action: { kind: 'pick-model' }, armed: true, label: 'Pick model', hint: 'Opens the model pill below. The next turn runs on what you pick.' };
    }
  }
  return { action: { kind: 'send' }, armed: !!text.trim(), label: null, hint: textHint(text, r, list, harness, 'reply') };
}

/**
 * The quiet line under the new-thread composer, against the list of the harness in its picker. Start
 * sends the message as typed, an Omni command's name included.
 */
export function newThreadHint(text: string, list: CommandList | null, harness: string): string | null {
  const r = resolveSlash(text, list?.commands ?? []);
  if (r?.kind === 'omni') return `/${r.name} works in a thread's reply box, so here it sends as text.`;
  return textHint(text, r, list, harness, 'new-thread');
}

/**
 * Why a `/name` in a message that sends as typed won't run, or might not: Claude Code leaves a
 * Mention to the model. Or what a command leaves out. None of these stops the send.
 */
function textHint(text: string, r: ReturnType<typeof resolveSlash>, list: CommandList | null, harness: string, where: 'reply' | 'new-thread'): string | null {
  if (r?.kind === 'terminal') return `/${r.name} only works in a ${harnessName(harness)} terminal, so it sends as text.`;
  // Until the list is in, any name could be one of the thread's commands.
  if (r?.kind === 'unknown' && list?.status === 'ready') {
    return `No /${r.name} command ${where === 'reply' ? 'in this thread' : `for ${harnessName(harness)} in this channel`}, so it sends as text.`;
  }
  if (harness === 'codex' && r?.kind === 'harness' && r.command.name === 'compact' && r.token.args.trim()) {
    return 'Codex compacts without instructions, so it leaves out the text after /compact.';
  }
  // Where no Omni command runs, one named later is just a word.
  const [late] = midMessageCommands(text, list?.commands ?? []).filter((c) => where === 'reply' || c.kind !== 'omni');
  if (late) return `/${late.name} only works at the start of a message, so here it stays text.`;
  if (harness !== 'claude-code') return null;
  const hits = mentionHits(text, list?.commands ?? []);
  // Each command once, as Ben first typed it.
  const typed = hits.filter((h, i) => hits.findIndex((o) => o.name === h.name) === i).map((h) => text.slice(h.start, h.end));
  return typed.length ? `Claude Code loads ${and(typed)} only if the model decides to.` : null;
}

/** "a", "a and b", "a, b and c". */
const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Enough of a thread to start another one with its settings. */
export interface ThreadSettings {
  channel_id: string;
  role: string | null;
  harness: string;
  model: string | null;
  effort: string;
  /** Set when Auto picked the thread's run: the new one starts on Auto too. */
  auto_reason: string | null;
}

/** The run `/clear` or `/new` starts the next thread on: this one's harness, model and effort, or Auto when Auto picked them. */
export const sameRun = (t: ThreadSettings): DraftRun => (t.auto_reason ? { choice: { ...AUTO_CHOICE }, effort: '' } : { choice: { harness: t.harness, model: t.model ?? '' }, effort: t.effort });

/** The POST /threads body `/clear <prompt>` sends: this thread's channel, harness, model, effort and role. */
export const newThreadBody = (t: ThreadSettings, prompt: string) => ({
  channel: t.channel_id,
  prompt,
  role: t.role || undefined,
  ...(t.auto_reason ? { model: AUTO } : { harness: t.harness, model: t.model || undefined, effort: t.effort || undefined }),
});
