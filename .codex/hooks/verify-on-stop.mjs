#!/usr/bin/env node
// Claude Code Stop hook: when this session changed app code but never ran the checks, send Claude back once to run
// the verify skill. A turn with no code change, or one that already ran typecheck/tests, stops as usual.
// stop_hook_active is set on the stop that follows a block, so this never loops.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CODE = /^(apps|packages)\/.*\.(ts|tsx|mjs|js|css|swift)$/;
const CHECKS = /npm (run )?(test|typecheck)|turbo (run )?(test|typecheck)|vitest|qa-stack\.sh|swift test/;

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {}
if (input.stop_hook_active) process.exit(0);

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: input.cwd || process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};
// Uncommitted changes plus commits on this branch that main does not have.
const base = git('merge-base', 'HEAD', 'origin/main').trim() || git('merge-base', 'HEAD', 'main').trim();
const changed = new Set(
  [git('diff', '--name-only', 'HEAD'), git('ls-files', '--others', '--exclude-standard'), base && git('diff', '--name-only', base, 'HEAD')]
    .join('\n')
    .split('\n')
    .filter((f) => CODE.test(f)),
);
if (changed.size === 0) process.exit(0);

// Did any Bash call in this session run the checks?
let ran = false;
try {
  for (const line of readFileSync(input.transcript_path, 'utf8').split('\n')) {
    if (!line.includes('"Bash"')) continue;
    const msg = JSON.parse(line).message;
    for (const part of Array.isArray(msg?.content) ? msg.content : []) {
      if (part.type === 'tool_use' && part.name === 'Bash' && CHECKS.test(String(part.input?.command ?? ''))) ran = true;
    }
  }
} catch {
  process.exit(0); // no transcript to read: do not block on a guess
}
if (ran) process.exit(0);

const files = [...changed].slice(0, 8).join(', ');
console.log(
  JSON.stringify({
    decision: 'block',
    reason: `You changed app code (${files}) but did not run any checks in this session. Use the verify skill (.claude/skills/verify/SKILL.md): run typecheck and the relevant tests, and for a visible or API change, check it on scripts/qa-stack.sh. Then report what you verified. If this turn really needs no verification, say why in one line.`,
  }),
);
