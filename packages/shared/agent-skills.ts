// An agent's skills (`skills:` in its crew file): the skills every thread of the agent loads when it starts, picked in
// Settings > Agents from the ones this machine's harnesses list. GET /api/skills (apps/server/skills.ts) is the list;
// this module is how every client draws it.

import type { CommandSource } from './slash.ts';

/** The harnesses that load an agent's skills: the ones that run on this machine, where the skill files are. */
export const SKILL_HARNESSES = ['claude-code', 'codex', 'cursor'] as const;
export type SkillHarness = (typeof SKILL_HARNESSES)[number];

export const SKILL_HARNESS_NAMES: Record<SkillHarness, string> = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };

/** Whether a harness loads skills. Hermes, Cursor Cloud, custom harnesses and remote agents run off this machine. */
export const loadsSkills = (harness: string | null | undefined): harness is SkillHarness => SKILL_HARNESSES.includes(harness as SkillHarness);

/** One skill as GET /api/skills lists it: what the harnesses that have it call it, and where it comes from. */
export interface SkillEntry {
  name: string;
  description: string;
  /** personal (the user's own folder), plugin, project (the channel's repo) or builtin (it ships with the harness). */
  source: CommandSource;
  /** The plugin it ships in, for a plugin skill. */
  plugin?: string;
  /** The harnesses on this machine that list it, in SKILL_HARNESSES order. */
  harnesses: SkillHarness[];
}

/** GET /api/skills. */
export interface SkillCatalog {
  skills: SkillEntry[];
  /** The harnesses whose list is in it. One that is not installed is neither here nor in `loading`. */
  listed: SkillHarness[];
  /** Harnesses still reading their list: ask again shortly. */
  loading: SkillHarness[];
}

/** A row of the Skills list: a skill the machine has, or a ticked one it no longer has (`entry` unset). */
export interface SkillRow {
  name: string;
  entry?: SkillEntry;
  picked: boolean;
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
/** How well a skill's name matches the search: the whole name, its start, anywhere in it, or not at all. */
function nameRank(e: SkillEntry, q: string[]): number {
  const name = e.name.toLowerCase();
  if (q.join(' ') === name) return 3;
  if (q.every((w) => name.startsWith(w))) return 2;
  return q.every((w) => name.includes(w)) ? 1 : 0;
}
const matches = (e: SkillEntry, q: string[]) => {
  const hay = `${e.name} ${e.plugin ?? ''} ${e.description}`.toLowerCase();
  return q.every((w) => hay.includes(w));
};

/**
 * What the Skills list shows: the ticked skills first, in the order they were ticked, then every other skill that
 * matches the search: the whole name first, then a name that starts with it, one that holds it, and last a
 * description that does, each by name. A search narrows the ticked ones too, but a ticked skill this machine lacks
 * always shows, so it can be unticked.
 */
export function skillRows(catalog: Partial<Pick<SkillCatalog, 'skills'>> | null | undefined, picked: readonly string[], query = ''): SkillRow[] {
  const q = words(query);
  const byName = new Map((catalog?.skills ?? []).map((e) => [e.name, e]));
  const ticked = picked.map((name) => ({ name, entry: byName.get(name), picked: true })).filter((r) => !r.entry || !q.length || matches(r.entry, q));
  const on = new Set(picked);
  const rest = [...byName.values()]
    .filter((e) => !on.has(e.name) && (!q.length || matches(e, q)))
    .sort((a, b) => (q.length ? nameRank(b, q) - nameRank(a, q) : 0) || a.name.localeCompare(b.name))
    .map((entry) => ({ name: entry.name, entry, picked: false }));
  return [...ticked, ...rest];
}

/** Tick or untick a skill: a new one goes last. */
export const toggleSkill = (picked: readonly string[], name: string): string[] => (picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name]);

const SOURCE_LABEL: Partial<Record<CommandSource, string>> = { personal: 'Personal', project: 'Project', builtin: 'Built-in' };

/**
 * A skill's line under its name: where it comes from, and the harnesses that have it when not every one that answered
 * does ("Personal · Codex only").
 */
export function skillMeta(entry: SkillEntry, listed: readonly SkillHarness[]): string {
  const from = entry.source === 'plugin' ? (entry.plugin ? `Plugin ${entry.plugin}` : 'Plugin') : (SOURCE_LABEL[entry.source] ?? '');
  const some = listed.length > 1 && entry.harnesses.length < listed.length;
  const only = some ? `${entry.harnesses.map((h) => SKILL_HARNESS_NAMES[h]).join(', ')} only` : '';
  return [from, only].filter(Boolean).join(' · ');
}

/** The Skills group's note for an agent whose default harness runs off this machine, or null when it loads skills. */
export function skillsHarnessNote(harness: string | null | undefined, name: (id: string) => string | undefined): string | null {
  if (!harness || loadsSkills(harness)) return null;
  return `Skills load on Claude Code, Codex and Cursor Agent. ${name(harness) ?? harness} runs off this machine, so its threads do not get them.`;
}
