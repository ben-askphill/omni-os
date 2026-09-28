// What the composers do with a `/`, as pure functions: the Omni commands every thread's menu offers,
// what Send does with a message that starts with one, and the quiet hints for commands that stay
// plain text. The new-thread composer offers no Omni commands. The grammar itself is in slash.ts.
// Shared by the Web UI and the Mac app's slash engine, so it imports nothing from web/ or mac/.
import { OMNI_COMMANDS, TITLE_MAX, mentionHits, midMessageCommands, resolveSlash, visibleCommands, type CommandList, type SlashCommand } from './slash.ts';

const HARNESS_NAME: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', hermes: 'Hermes' };
export const harnessName = (id: string) => HARNESS_NAME[id] ?? id;

/**
 * A composer's menu: its harness's list, less the built-ins Omni runs in their place. A thread's
 * reply box adds Omni's own commands, which work on every harness.
 */
export const menuCommands = (list: SlashCommand[] | undefined, where: 'reply' | 'new-thread'): SlashCommand[] => [
  ...visibleCommands(list ?? []),
  ...(where === 'reply' ? OMNI_COMMANDS : []),
];

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
        return { action: { kind: 'fixed' }, armed: false, label: null, hint: 'The model, effort and fast mode are fixed per thread.' };
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
