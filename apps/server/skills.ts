// An agent's skills (`skills:` in its crew file, crew.ts): the ones every thread of the agent loads when it starts,
// without its brief or charter naming them. Omni copies no skill. Each harness lists its own, in the command lists the
// `/` menu reads (commands.ts), and Settings > Agents picks from them (GET /api/skills). When a thread starts, its
// harness loads each ticked skill its own way:
// - Claude Code: the system prompt has it call the Skill tool for each, before anything else (runner/prompts.ts). The
//   Skill tool refuses a skill whose SKILL.md says `disable-model-invocation: true` (only a typed `/name` runs it), so
//   one of those, ticked by the user, is read from its file instead.
// - Codex: each goes with the thread's first turn as a skill item (codex/adapter.ts), as a `/name` the user types does.
// - Cursor Agent: the system prompt, which Cursor gets with its first prompt, has it load each.
// A skill its harness does not list, whose SKILL.md is in the user's or the repo's skill folders, is read from that file
// instead. Hermes, Cursor Cloud, custom harnesses and remote agents run off this machine, where the skills are not, so
// they get none. A quick ask gets none either: it only reads, and answers in one reply.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadsSkills, SKILL_HARNESS_NAMES, SKILL_HARNESSES, type SkillCatalog, type SkillEntry, type SkillHarness } from '@omni/shared/agent-skills.ts';
import { readsOnly } from '@omni/shared/quick-ask.ts';
import type { CommandList, SlashCommand } from '@omni/shared/slash.ts';
import { listCommands, peekCommands } from './commands.ts';
import type { CrewRole } from './crew.ts';
import { profileOf } from './harness/profile.ts';

export { loadsSkills };

/** A harness command that is a skill: one a message can name, not a built-in or an MCP prompt. */
const isSkill = (c: SlashCommand) => c.mentionable && c.source !== 'mcp';

/** Settings waits this long for the harnesses that are still reading their lists, then shows what it has. */
const CATALOG_WAIT_MS = 10_000;
/** A thread's start waits this long for its harness's list, then loads the skills by name alone. */
const LAUNCH_WAIT_MS = 5_000;

/** A harness's list for a folder, waiting for a probe that is running at most `ms`. Null when it has none to give in time. */
async function listed(harness: SkillHarness, folder: string, ms: number): Promise<CommandList | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const list = await Promise.race([listCommands(harness, folder, { wait: true }), new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)))]);
    return list?.status === 'ready' ? list : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every skill this machine's harnesses list for a folder, merged by name, for Settings > Agents. `folder` is where a
 * thread of the agent reads its commands: its default channel's checkout lists that repo's project skills too.
 */
export async function skillCatalog(folder: string): Promise<SkillCatalog> {
  const lists = await Promise.all(SKILL_HARNESSES.map(async (h) => [h, await listed(h, folder, CATALOG_WAIT_MS)] as const));
  const byName = new Map<string, SkillEntry>();
  const listedBy: SkillHarness[] = [];
  const loading: SkillHarness[] = [];
  for (const [h, list] of lists) {
    if (!list) {
      // Still reading its first list (a cached one is served at once), or not installed or not answering.
      if (peekCommands(h, folder).status === 'loading') loading.push(h);
      continue;
    }
    listedBy.push(h);
    for (const c of list.commands.filter(isSkill)) {
      const e = byName.get(c.name);
      if (e) {
        if (!e.harnesses.includes(h)) e.harnesses.push(h);
        if (!e.description) e.description = c.description;
        continue;
      }
      byName.set(c.name, { name: c.name, description: c.description, source: c.source, ...(c.plugin && { plugin: c.plugin }), harnesses: [h] });
    }
  }
  return { skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), listed: listedBy, loading };
}

/** What a thread's harness does with its agent's skills. */
export interface ThreadSkills {
  harness: SkillHarness;
  /** Skills the harness lists, which it loads itself. A Codex skill carries the file Codex loads it from. */
  native: { name: string; path?: string }[];
  /**
   * Skills the harness does not load itself, whose SKILL.md is on this machine: one it does not list, or one Claude
   * Code's Skill tool refuses (userOnly). The agent reads each file.
   */
  files: { name: string; path: string }[];
  /** Ticked skills this machine has no trace of. */
  missing: string[];
}

/**
 * Where a skill's SKILL.md is, when one of the folders the harnesses read holds it: the user's (Claude Code's, the
 * shared ~/.agents and Codex's) and the thread's repo's. A plugin skill (`plugin:skill`) has no such file.
 */
export function skillFile(name: string, cwd: string, home = homedir()): string | null {
  if (name.includes(':') || name.includes('/')) return null;
  const roots = [join(home, '.claude', 'skills'), join(home, '.agents', 'skills'), join(home, '.codex', 'skills'), join(cwd, '.claude', 'skills'), join(cwd, '.agents', 'skills')];
  for (const root of roots) {
    const file = join(root, name, 'SKILL.md');
    if (existsSync(file)) return file;
  }
  return null;
}

/** Whether a SKILL.md keeps its skill from the model: Claude Code's Skill tool then refuses to load it. */
export function userOnly(file: string): boolean {
  try {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
    return /^disable-model-invocation:\s*true\s*$/m.test(front);
  } catch {
    return false;
  }
}

const named = (list: SlashCommand[], name: string) => list.find((c) => isSkill(c) && (c.name === name || c.aliases?.includes(name)));

/**
 * The skills a thread of `role` loads, and how, or null when it loads none: no skills ticked, a quick ask, or a
 * harness that runs off this machine. Codex's skills come from its list for the thread's own folder, the files it
 * loads from. Claude Code and Cursor Agent load a skill by name, so theirs come from the list for `folder`, the
 * channel's checkout, which a worktree of it shares and which is usually cached already. A list that does not answer
 * in time leaves every skill to the harness by name.
 */
export async function threadSkills(role: Pick<CrewRole, 'skills'> | undefined, thread: { harness: string; cwd: string; quick?: number | null; workspace?: string | null }, folder: string): Promise<ThreadSkills | null> {
  const names = role?.skills ?? [];
  const harness = thread.harness;
  if (!names.length || !loadsSkills(harness) || readsOnly(thread)) return null;
  const loading = profileOf(harness).skills;
  const list = await listed(harness, loading?.listsThreadFolder ? thread.cwd : folder, LAUNCH_WAIT_MS);
  const out: ThreadSkills = { harness, native: [], files: [], missing: [] };
  for (const name of names) {
    const hit = list ? named(list.commands, name) : undefined;
    const own = loading?.userOnlyFromFile ? skillFile(hit?.name ?? name, thread.cwd) : null;
    if (own && userOnly(own)) {
      out.files.push({ name: hit?.name ?? name, path: own });
      continue;
    }
    if (hit || !list) {
      out.native.push({ name: hit?.name ?? name, ...(hit?.path && { path: hit.path }) });
      continue;
    }
    const file = skillFile(name, thread.cwd);
    if (file) out.files.push({ name, path: file });
    else out.missing.push(name);
  }
  return out;
}

const listOf = (names: string[]) => names.map((n) => `\`${n}\``).join(', ');

/** The system prompt's Skills section for a thread whose agent has skills (runner/prompts.ts). */
export function skillLines(s: ThreadSkills, agent: string): string[] {
  const lines = ['', '## Skills'];
  const native = s.native.map((x) => x.name);
  lines.push(...(profileOf(s.harness).skills?.lines(s, agent, listOf) ?? []));
  if (s.files.length)
    lines.push(
      `${native.length ? 'These' : `${agent} loads these skills in every thread. These`} load from their files, since ${SKILL_HARNESS_NAMES[s.harness]} does not load them itself here: read each SKILL.md in full before anything else and follow it as a skill: ${s.files.map((f) => `\`${f.name}\` (${f.path})`).join(', ')}.`,
    );
  if (s.missing.length) lines.push(`Also ticked for ${agent}, but not on this machine, so they did not load: ${listOf(s.missing)}. Say so if the task needed one.`);
  return lines.length > 2 ? lines : [];
}

/** One line for the server log: what a thread's harness was asked to load. */
export function skillsLogLine(threadId: string, s: ThreadSkills): string {
  const part = (label: string, names: string[]) => (names.length ? ` ${label}: ${names.join(', ')}` : '');
  const how = profileOf(s.harness).skills?.how ?? 'prompt';
  return `[skills] ${threadId} ${s.harness}:${part(how, s.native.map((x) => x.name))}${part('read files', s.files.map((f) => f.name))}${part('missing', s.missing)}`;
}
