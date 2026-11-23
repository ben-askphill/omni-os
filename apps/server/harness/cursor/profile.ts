// Cursor Agent's profile (harness/profile.ts): what it does beyond running a session.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessProfile } from '../profile.ts';

/** Found the way Cursor Agent finds it, as in harness/cursor/commands.ts. */
const cursorDir = (home: string, env: NodeJS.ProcessEnv) =>
  env.CURSOR_CONFIG_DIR?.trim() || (env.XDG_CONFIG_HOME?.trim() ? join(env.XDG_CONFIG_HOME, 'cursor') : join(home, '.cursor'));

/** Cursor records the cwd in the chat's meta.json; a copy from another machine gets this one's. */
function withCwd(body: Uint8Array, cwd: string): Uint8Array {
  try {
    const meta = JSON.parse(Buffer.from(body).toString('utf8'));
    if (meta && typeof meta === 'object' && 'cwd' in meta) return Buffer.from(JSON.stringify({ ...meta, cwd }));
  } catch {
    // Not JSON: write it as it came.
  }
  return body;
}

export const cursorProfile: HarnessProfile = {
  compact: null,
  // An estimate from its turn totals, with the tokens and cost kept beside it.
  meter: 'estimate',
  skills: {
    listsThreadFolder: false,
    userOnlyFromFile: false,
    how: 'prompt',
    lines: (s, agent, list) =>
      s.native.length
        ? [`${agent} loads these skills in every thread. Before anything else, load each one and follow it, even when the task looks like it does not need it: ${list(s.native.map((x) => x.name))}.`]
        : [],
  },
  // ~/.cursor/chats/<md5 of cwd>/<session>, holding meta.json and store.db.
  sessionFiles: {
    base: (home, env) => join(cursorDir(home, env), 'chats'),
    root: (base, t) => join(base, createHash('md5').update(t.cwd).digest('hex'), t.session_id),
    owns: (_t, rel) => !rel.includes('/') && !rel.endsWith('-shm'),
    local: (_t, root) => {
      if (!existsSync(root)) return [];
      return readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.') && !e.name.endsWith('-shm'))
        .map((e) => e.name)
        .sort();
    },
    object: (sessionId, rel) => `sessions/cursor/${sessionId}/${rel}`,
    adapt: (rel, body, t) => (rel === 'meta.json' ? withCwd(body, t.cwd) : body),
  },
  namesSessionLate: true,
  confirmsByReplay: false,
  claudeAi: false,
  goalCommand: false,
  inlineImageMax: null,
  pushesBranch: false,
};
