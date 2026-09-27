// The slash grammar, shared by the server and the web app so both agree on what a message runs.
// See CONTEXT.md: a Slash command is a Harness command or an Omni command.

/** Where a command comes from, as the menu groups it. `mcp`: an MCP server's prompt, which only a thread's running process lists. */
export type CommandSource = 'omni' | 'project' | 'personal' | 'plugin' | 'mcp' | 'builtin';

/** One command a thread's `/` menu offers, in the same shape for every harness. */
export interface SlashCommand {
  name: string;
  /** Other names that run it, e.g. a plugin command's short name. */
  aliases?: string[];
  /** One line, with the harness's scope tag and plugin prefix stripped. */
  description: string;
  argumentHint?: string;
  source: CommandSource;
  /** The plugin it ships in, for plugin commands. */
  plugin?: string;
  /** Can be named after the start of a message as a Mention. */
  mentionable: boolean;
  /** The file a Codex skill loads from, which Omni sends with the message. */
  path?: string;
}

/** A `/name` token in a message. `end` is exclusive. */
export interface SlashToken {
  name: string;
  start: number;
  end: number;
}

export interface ParsedSlash {
  /** The command a message starts with, and the text after it. */
  lead: (SlashToken & { args: string }) | null;
  /** Every other `/name` in the message: one after whitespace. */
  mentions: SlashToken[];
}

/** Commands Omni runs itself, in place of the harness built-ins that would change what Omni tracks. */
export const OMNI_COMMANDS: SlashCommand[] = [
  { name: 'clear', description: 'Start a new thread with the same settings', source: 'omni', mentionable: false },
  { name: 'new', description: 'Start a new thread with the same settings', source: 'omni', mentionable: false },
  { name: 'rename', argumentHint: '<title>', description: 'Rename this thread', source: 'omni', mentionable: false },
  { name: 'model', description: 'Start a new thread on another model', source: 'omni', mentionable: false },
  { name: 'effort', description: 'Start a new thread with another effort', source: 'omni', mentionable: false },
  { name: 'fast', description: 'Start a new thread in fast mode', source: 'omni', mentionable: false },
];

const OMNI_NAMES = new Set(OMNI_COMMANDS.map((c) => c.name));

/** Built-ins that only work in the harness's own terminal. The menu leaves them out. */
const TERMINAL_ONLY = new Set([
  'login',
  'logout',
  'config',
  'settings',
  'mcp',
  'resume',
  'continue',
  'exit',
  'quit',
  'color',
  'focus',
  'heapdump',
  'auto-mode-setup',
  'workflow-launch-exec',
]);

export const isOmniCommand = (name: string) => OMNI_NAMES.has(name.toLowerCase());
export const isTerminalOnly = (name: string) => name.startsWith('__') || TERMINAL_ONLY.has(name.toLowerCase());

/**
 * A harness's list as the menu offers it: no terminal-only commands, and nothing under an Omni
 * command's name, since the Omni command runs in its place.
 */
export const visibleCommands = (commands: SlashCommand[]) => commands.filter((c) => !isTerminalOnly(c.name) && !isOmniCommand(c.name));

// A name is letters, digits, `.`, `_`, `:` and `-`, starts with a letter or digit, and ends at
// whitespace or the end of the text. Anything else glued on (a second `/`, a comma) means it is
// a path, a URL or prose, never a command.
const NAME = '[A-Za-z0-9][A-Za-z0-9._:-]*';
const LEAD = new RegExp(`^(\\s*)\\/(${NAME})(?=\\s|$)`);
const LATER = new RegExp(`(?<=\\s)\\/(${NAME})(?=\\s|$)`, 'g');

/** Whether a harness command's name can be typed after a `/` at all. */
export const isCommandName = (name: string) => new RegExp(`^${NAME}$`).test(name);

export function parseSlash(text: string): ParsedSlash {
  const m = LEAD.exec(text);
  let lead: ParsedSlash['lead'] = null;
  if (m) {
    const start = m[1].length;
    const end = start + 1 + m[2].length;
    lead = { name: m[2], start, end, args: text.slice(end).replace(/^\s+/, '') };
  }
  const mentions = [...text.matchAll(LATER)]
    .map((x) => ({ name: x[1], start: x.index, end: x.index + x[0].length }))
    // Leading spaces put the leading command after whitespace too.
    .filter((t) => t.start !== lead?.start);
  return { lead, mentions };
}

export type SlashResolution =
  | { kind: 'harness'; name: string; command: SlashCommand; token: SlashToken & { args: string } }
  | { kind: 'omni' | 'terminal' | 'unknown'; name: string; token: SlashToken & { args: string } };

const names = (c: SlashCommand) => [c.name, ...(c.aliases ?? [])];

/** Match a name against a command list: exact name or alias first, then any case. */
export function findCommand(name: string, commands: SlashCommand[]): SlashCommand | undefined {
  const lower = name.toLowerCase();
  return commands.find((c) => names(c).includes(name)) ?? commands.find((c) => names(c).some((n) => n.toLowerCase() === lower));
}

/** What a message's leading command is, against a thread's command list. Null when it has none. */
export function resolveSlash(text: string, commands: SlashCommand[]): SlashResolution | null {
  const { lead } = parseSlash(text);
  if (!lead) return null;
  const { name } = lead;
  if (isOmniCommand(name)) return { kind: 'omni', name, token: lead };
  const command = findCommand(name, commands);
  if (command) return { kind: 'harness', name, command, token: lead };
  return { kind: isTerminalOnly(name) ? 'terminal' : 'unknown', name, token: lead };
}

/** A command that only works at the start of a message, typed later in one. */
export interface LateCommand extends SlashToken {
  /** An Omni command, or a harness command that can't be a Mention (a built-in or an MCP prompt). */
  kind: 'omni' | 'builtin';
}

/** The start-only commands named after the start of a message, so the composer can say they stay text. */
export function midMessageCommands(text: string, commands: SlashCommand[]): LateCommand[] {
  return parseSlash(text).mentions.flatMap((t): LateCommand[] => {
    if (isOmniCommand(t.name)) return [{ ...t, kind: 'omni' }];
    const c = findCommand(t.name, commands);
    return c && !c.mentionable ? [{ ...t, kind: 'builtin' }] : [];
  });
}

/** A resolved command as a user event stores it, so its pill keeps the description it had when sent. */
export interface SlashHit {
  name: string;
  source: CommandSource;
  description: string;
  argumentHint?: string;
  start: number;
  end: number;
}

export interface SlashRecord {
  /** The harness command the message starts with. */
  command?: SlashHit;
  /** The Mentions after it, in order. */
  mentions?: SlashHit[];
}

const hit = ({ name, source, description, argumentHint }: SlashCommand, { start, end }: SlashToken): SlashHit => ({
  name,
  source,
  description,
  ...(argumentHint && { argumentHint }),
  start,
  end,
});

/** The skills and custom commands a message names after its start, each resolved on its own. */
export function mentionHits(text: string, commands: SlashCommand[]): SlashHit[] {
  return parseSlash(text).mentions.flatMap((t) => {
    const c = isOmniCommand(t.name) ? undefined : findCommand(t.name, commands);
    return c?.mentionable ? [hit(c, t)] : [];
  });
}

/** The slash field for a user event: set only when the message starts with a harness command or carries a Mention. */
export function slashRecord(text: string, commands: SlashCommand[]): SlashRecord | undefined {
  const r = resolveSlash(text, commands);
  const command = r?.kind === 'harness' ? hit(r.command, r.token) : undefined;
  const mentions = mentionHits(text, commands);
  if (!command && !mentions.length) return undefined;
  return { ...(command && { command }), ...(mentions.length && { mentions }) };
}
