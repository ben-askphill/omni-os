// The slash grammar, shared by the server and the web app so both agree on what a message runs.
// See CONTEXT.md: a Slash command is a Harness command or an Omni command.

/** Where a command comes from, as the menu groups it. */
export type CommandSource = 'omni' | 'project' | 'personal' | 'plugin' | 'builtin';

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

/** Whether a harness command's name can be typed after a `/` at all. */
export const isCommandName = (name: string) => new RegExp(`^${NAME}$`).test(name);

export function parseSlash(text: string): ParsedSlash {
  const m = LEAD.exec(text);
  if (!m) return { lead: null };
  const start = m[1].length;
  const end = start + 1 + m[2].length;
  return { lead: { name: m[2], start, end, args: text.slice(end).replace(/^\s+/, '') } };
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
  command: SlashHit;
}

/** The slash field for a user event: set only when the message starts with a harness command. */
export function slashRecord(text: string, commands: SlashCommand[]): SlashRecord | undefined {
  const r = resolveSlash(text, commands);
  if (r?.kind !== 'harness') return undefined;
  const { name, source, description, argumentHint } = r.command;
  return { command: { name, source, description, ...(argumentHint && { argumentHint }), start: r.token.start, end: r.token.end } };
}
