// Codex's profile (harness/profile.ts): what it does beyond running a session.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeRel } from '../../sync/paths.ts';
import type { HarnessProfile } from '../profile.ts';

const codexHome = (home: string, env: NodeJS.ProcessEnv) => env.CODEX_HOME?.trim() || join(home, '.codex');

const rollout = (sessionId: string) => `-${sessionId}.jsonl`;

/**
 * The first Codex rollout under root whose name ends in suffix. A linked folder is not walked into. A folder it cannot
 * read throws, so a handoff fails rather than move the thread without its session.
 */
function findRollout(root: string, suffix: string): string | null {
  if (!existsSync(root)) return null;
  const dirs = [''];
  while (dirs.length) {
    const dir = dirs.shift()!;
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) dirs.push(rel);
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith(suffix)) return rel;
    }
  }
  return null;
}

const owns = (t: { session_id: string }, rel: string) => rel.endsWith(rollout(t.session_id)) && rel.split('/').at(-1)!.startsWith('rollout-');

export const codexProfile: HarnessProfile = {
  // Codex's /compact takes no instructions.
  compact: { focus: false },
  meter: 'reported',
  skills: {
    listsThreadFolder: true,
    userOnlyFromFile: false,
    how: 'skill items',
    lines: (s, agent, list) => {
      const attached = s.native.filter((x) => x.path).map((x) => x.name);
      const unattached = s.native.filter((x) => !x.path).map((x) => x.name);
      return [
        ...(attached.length ? [`${agent} loads these skills in every thread. They came loaded with your first message: ${list(attached)}. Follow them.`] : []),
        ...(unattached.length ? [`${agent} loads these skills in every thread. Before anything else, read each one's SKILL.md in full and follow it: ${list(unattached)}.`] : []),
      ];
    },
  },
  // $CODEX_HOME/sessions, holding "<yyyy>/<mm>/<dd>/rollout-<time>-<session>.jsonl".
  sessionFiles: {
    base: (home, env) => join(codexHome(home, env), 'sessions'),
    root: (base) => base,
    owns,
    local: (t, root, synced) => {
      const hint = synced.find((rel) => safeRel(rel) && owns(t, rel) && existsSync(join(root, rel)));
      if (hint) return [hint];
      const hit = findRollout(root, rollout(t.session_id));
      return hit ? [hit] : [];
    },
    object: (sessionId) => `sessions/codex/${sessionId}.jsonl`,
  },
  namesSessionLate: true,
  confirmsByReplay: false,
  claudeAi: false,
  goalCommand: false,
  // Codex takes any image as a local one.
  inlineImageMax: null,
  pushesBranch: false,
};
