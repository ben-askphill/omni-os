// The composer's `/` menu as pure functions: the command being typed at the caret, what the menu
// lists for it, and what picking a row does to the text. The grammar itself is in shared/slash.ts.
import type { CommandSource, SlashCommand } from '../../shared/slash.ts';

/**
 * The command being typed, with the caret in its name: the slash that starts the message, or a
 * Mention's slash after whitespace later on. `end` is where the name ends.
 */
export interface SlashQuery {
  query: string;
  start: number;
  end: number;
  /** A skill or custom command named after the start of the message. */
  mention?: true;
}

const TYPING = /^(\s*)\/([A-Za-z0-9._:-]*)$/;
const TYPING_MENTION = /(?<=\s)\/([A-Za-z0-9._:-]*)$/;
const NAME_REST = /^[A-Za-z0-9._:-]*/;

export function slashQuery(text: string, caret: number): SlashQuery | null {
  const before = text.slice(0, caret);
  const lead = TYPING.exec(before);
  const later = lead ? null : TYPING_MENTION.exec(before);
  if (!lead && !later) return null;
  const end = caret + NAME_REST.exec(text.slice(caret))![0].length;
  // A name runs to whitespace or the end; anything else glued on makes it a path or prose.
  if (end < text.length && !/\s/.test(text[end])) return null;
  if (lead) return { query: lead[2], start: lead[1].length, end };
  return { query: later![1], start: later!.index, end, mention: true };
}

export interface MenuSection {
  /** The group's heading. Null for search results, which are one ranked list. */
  label: string | null;
  commands: SlashCommand[];
}

const GROUPS: [CommandSource, string][] = [
  ['project', 'Project'],
  ['personal', 'Personal'],
  ['plugin', 'Plugins'],
  ['mcp', 'MCP'],
  ['builtin', 'Built-in'],
  ['omni', 'Omni'],
];

/** The tag a row shows for where its command comes from. */
export const SOURCE_TAG: Record<CommandSource, string> = {
  project: 'project',
  personal: 'personal',
  plugin: 'plugin',
  mcp: 'mcp',
  builtin: 'built-in',
  omni: 'omni',
};

const byName = (a: SlashCommand, b: SlashCommand) => a.name.localeCompare(b.name);

/** The rank of a match on the description alone. */
const DESCRIPTION = 4;

/** How well a command matches the search, 0 best. Null when it doesn't match. */
function rank(c: SlashCommand, q: string): number | null {
  const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
  if (names.includes(q)) return 0;
  if (names.some((n) => n.startsWith(q))) return 1;
  // A word inside a name, like the part of a plugin command after its plugin.
  if (names.some((n) => n.split(/[:._-]/).some((w) => w.startsWith(q)))) return 2;
  if (names.some((n) => n.includes(q))) return 3;
  if (c.description.toLowerCase().includes(q)) return DESCRIPTION;
  return null;
}

/** How many of the commands Ben used recently the menu lists first. */
const RECENT_ROWS = 5;

/**
 * With no search text, the commands Ben used most recently (`recent`, names newest first), then the
 * rest grouped by source. With search text, every command in one ranked list.
 */
export function menuSections(commands: SlashCommand[], query: string, recent: string[] = []): MenuSection[] {
  return sections(commands, query, recent, DESCRIPTION);
}

/**
 * The menu for a Mention: the skills and custom commands a message can name after its start, listed
 * the same way, except a search matches names and aliases only, so prose after a `/` stays prose.
 */
export function mentionSections(commands: SlashCommand[], query: string, recent: string[] = []): MenuSection[] {
  return sections(commands.filter((c) => c.mentionable), query, recent, DESCRIPTION - 1);
}

/** The menu for `commands`, taking matches ranked `worst` or better. */
function sections(commands: SlashCommand[], query: string, recent: string[], worst: number): MenuSection[] {
  const q = query.toLowerCase();
  if (!q) {
    // A name the list doesn't have was used in another folder, or its command is gone.
    const top = [...new Set(recent)].flatMap((n) => commands.find((c) => c.name === n) ?? []).slice(0, RECENT_ROWS);
    const rest = commands.filter((c) => !top.includes(c));
    return [
      { label: 'Recent', commands: top },
      ...GROUPS.map(([source, label]) => ({ label, commands: rest.filter((c) => c.source === source).sort(byName) })),
    ].filter((s) => s.commands.length);
  }
  // Among matches as good as each other, the one Ben used last comes first.
  const used = (c: SlashCommand) => {
    const i = recent.indexOf(c.name);
    return i < 0 ? recent.length : i;
  };
  const hits = commands.flatMap((c) => {
    const r = rank(c, q);
    return r === null || r > worst ? [] : [{ c, r }];
  });
  hits.sort((a, b) => a.r - b.r || used(a.c) - used(b.c) || byName(a.c, b.c));
  return hits.length ? [{ label: null, commands: hits.map((h) => h.c) }] : [];
}

/** The text after picking a command: `/name ` in place of what was typed, with the caret after the space. */
export function pickCommand(text: string, at: SlashQuery, name: string): { text: string; caret: number } {
  const after = text.slice(at.end);
  const insert = `/${name}${/^[ \t]/.test(after) ? '' : ' '}`;
  return { text: text.slice(0, at.start) + insert + after, caret: at.start + name.length + 2 };
}
