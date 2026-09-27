// The composer's `/` menu as pure functions: the command being typed at the caret, what the menu
// lists for it, and what picking a row does to the text. The grammar itself is in shared/slash.ts.
import type { CommandSource, SlashCommand } from '../../shared/slash.ts';

/** The command being typed: the slash that starts the message, with the caret in its name. `end` is where the name ends. */
export interface SlashQuery {
  query: string;
  start: number;
  end: number;
}

const TYPING = /^(\s*)\/([A-Za-z0-9._:-]*)$/;
const NAME_REST = /^[A-Za-z0-9._:-]*/;

export function slashQuery(text: string, caret: number): SlashQuery | null {
  const m = TYPING.exec(text.slice(0, caret));
  if (!m) return null;
  const end = caret + NAME_REST.exec(text.slice(caret))![0].length;
  // A name runs to whitespace or the end; anything else glued on makes it a path or prose.
  if (end < text.length && !/\s/.test(text[end])) return null;
  return { query: m[2], start: m[1].length, end };
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
  ['builtin', 'Built-in'],
  ['omni', 'Omni'],
];

/** The tag a row shows for where its command comes from. */
export const SOURCE_TAG: Record<CommandSource, string> = {
  project: 'project',
  personal: 'personal',
  plugin: 'plugin',
  builtin: 'built-in',
  omni: 'omni',
};

const byName = (a: SlashCommand, b: SlashCommand) => a.name.localeCompare(b.name);

/** How well a command matches the search, 0 best. Null when it doesn't match. */
function rank(c: SlashCommand, q: string): number | null {
  const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
  if (names.includes(q)) return 0;
  if (names.some((n) => n.startsWith(q))) return 1;
  // A word inside a name, like the part of a plugin command after its plugin.
  if (names.some((n) => n.split(/[:._-]/).some((w) => w.startsWith(q)))) return 2;
  if (names.some((n) => n.includes(q))) return 3;
  if (c.description.toLowerCase().includes(q)) return 4;
  return null;
}

/** With no search text, the list grouped by source. With search text, every group in one ranked list. */
export function menuSections(commands: SlashCommand[], query: string): MenuSection[] {
  const q = query.toLowerCase();
  if (!q) {
    return GROUPS.map(([source, label]) => ({ label, commands: commands.filter((c) => c.source === source).sort(byName) })).filter(
      (s) => s.commands.length,
    );
  }
  const hits = commands.flatMap((c) => {
    const r = rank(c, q);
    return r === null ? [] : [{ c, r }];
  });
  hits.sort((a, b) => a.r - b.r || byName(a.c, b.c));
  return hits.length ? [{ label: null, commands: hits.map((h) => h.c) }] : [];
}

/** The text after picking a command: `/name ` in place of what was typed, with the caret after the space. */
export function pickCommand(text: string, at: SlashQuery, name: string): { text: string; caret: number } {
  const after = text.slice(at.end);
  const insert = `/${name}${/^[ \t]/.test(after) ? '' : ' '}`;
  return { text: text.slice(0, at.start) + insert + after, caret: at.start + name.length + 2 };
}
