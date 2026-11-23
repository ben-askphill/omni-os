// Claude Code's profile (harness/profile.ts): what it does beyond running a session.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_INLINE_IMAGE } from '../../uploads.ts';
import type { HarnessProfile } from '../profile.ts';

/** Claude Code names a project folder after its cwd: every character that is not a letter or digit becomes "-". */
export const claudeProjectDir = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

export const claudeProfile: HarnessProfile = {
  // /compact, with optional instructions after it.
  compact: { focus: true },
  meter: 'transcript',
  skills: {
    listsThreadFolder: false,
    userOnlyFromFile: true,
    how: 'Skill tool',
    lines: (s, agent, list) =>
      s.native.length
        ? [`${agent} loads these skills in every thread. Before anything else, load each one with the Skill tool, one call per skill, even when the task looks like it does not need it: ${list(s.native.map((x) => x.name))}. Load them once per thread, then follow them.`]
        : [],
  },
  // ~/.claude/projects/<cwd with non-alphanumerics as "-">, holding "<session>.jsonl".
  sessionFiles: {
    base: (home) => join(home, '.claude', 'projects'),
    root: (base, t) => join(base, claudeProjectDir(t.cwd)),
    owns: (t, rel) => rel === `${t.session_id}.jsonl`,
    local: (t, root) => (existsSync(join(root, `${t.session_id}.jsonl`)) ? [`${t.session_id}.jsonl`] : []),
    object: (sessionId) => `sessions/claude-code/${sessionId}.jsonl`,
  },
  namesSessionLate: false,
  confirmsByReplay: true,
  claudeAi: true,
  goalCommand: true,
  // The Claude Code image block is size capped.
  inlineImageMax: MAX_INLINE_IMAGE,
  pushesBranch: false,
};
