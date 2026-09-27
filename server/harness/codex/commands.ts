// Codex's skills, as its app-server's skills/list lists them for a folder. They are Codex's
// commands: a message that starts with `/name` loads that skill.
import { isCommandName, type CommandSource, type SlashCommand } from '../../../shared/slash.ts';
import { harnessEnv } from '../env-guard.ts';
import { codexBin } from './bin.ts';
import { CodexClient } from './client.ts';
import type { SkillMetadata, SkillsListResponse } from './protocol.ts';

/** About 0.3s on Ben's Mac (2026-09-27); anything near this is a wedged CLI. */
const PROBE_TIMEOUT_MS = 15_000;

/** Ask Codex which skills it has in a folder. Null when it doesn't answer. */
export function probeCodexSkills(cwd: string): Promise<SlashCommand[] | null> {
  const bin = codexBin();
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const client = new CodexClient({ bin, cwd, env: harnessEnv('codex', {}), onExit: () => finish(null) });
    // A binary that can't be run (a stale OMNI_CODEX_BIN) is an error event, not an exit.
    client.child.on('error', () => finish(null));
    const finish = (list: SlashCommand[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.kill();
      resolve(list);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    (async () => {
      try {
        await client.request('initialize', { clientInfo: { name: 'omni-os-commands', version: '0.1.0' } });
        client.notify('initialized', {});
        const res = await client.request<SkillsListResponse>('skills/list', { cwds: [cwd] });
        const skills = res?.data?.[0]?.skills;
        finish(Array.isArray(skills) ? normalizeCodexSkills(skills) : null);
      } catch {
        finish(null);
      }
    })();
  });
}

const SCOPE_SOURCE: Record<string, CommandSource> = { repo: 'project', user: 'personal', system: 'builtin', admin: 'builtin' };

const oneLine = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/** Turn one folder's skills/list entries into the menu's shape. */
export function normalizeCodexSkills(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const s of raw as Partial<SkillMetadata>[]) {
    const name = typeof s?.name === 'string' ? s.name : '';
    if (!isCommandName(name) || s.enabled === false || typeof s.path !== 'string' || seen.has(name)) continue;
    seen.add(name);
    const cmd: SlashCommand = {
      name,
      // The short description, when a skill has one, fits the menu's one line.
      description: oneLine(s.interface?.shortDescription) || oneLine(s.shortDescription) || oneLine(s.description),
      source: SCOPE_SOURCE[s.scope ?? ''] ?? 'builtin',
      mentionable: true,
      path: s.path,
    };
    if (s.pluginId) {
      cmd.source = 'plugin';
      const colon = name.indexOf(':');
      cmd.plugin = colon > 0 ? name.slice(0, colon) : s.pluginId.split('@')[0];
    }
    out.push(cmd);
  }
  return out;
}
