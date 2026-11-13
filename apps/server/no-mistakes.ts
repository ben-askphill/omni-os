// Optional gate: Kun Chen's no-mistakes (https://github.com/kunchenguid/no-mistakes).
// Omni never requires the binary. A local thread is told to push through it only when this
// process can see the command and the checkout it is about to run in has the git remote
// that `no-mistakes init` adds. Hermes and Cursor Cloud never get here: their turns are
// not on this machine. See docs/user/no-mistakes.md.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const REMOTE = 'no-mistakes';

function commandOnPath(name: string, env: NodeJS.ProcessEnv): boolean {
  try {
    const out = execFileSync('which', [name], {
      encoding: 'utf8',
      env,
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

/** git stdout, or null when git is missing, the path is not a repo, or the call does not finish. */
function gitLine(cwd: string, args: string[], env: NodeJS.ProcessEnv): string | null {
  try {
    const out = execFileSync(
      'git',
      ['--no-optional-locks', '-C', cwd, '-c', 'core.fsmonitor=', ...args],
      { encoding: 'utf8', env, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * True when this checkout should ship through the gate.
 * The working directory has to be the checkout root. A thread folder under `data/` sits inside
 * the Omni repo and would otherwise inherit this repo's remote. A linked worktree's root is its
 * own top, so a worktree thread still matches, and it sees the remotes of the repo it came from.
 */
export function noMistakesGate(cwd: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    if (!cwd) return false;
    if (!commandOnPath(REMOTE, env)) return false;
    const top = gitLine(cwd, ['rev-parse', '--show-toplevel'], env);
    if (!top) return false;
    if (realpathSync(top) !== realpathSync(resolve(cwd))) return false;
    return gitLine(cwd, ['remote', 'get-url', REMOTE], env) !== null;
  } catch {
    return false;
  }
}

/** Prompt lines for a thread whose checkout has the gate. `name` is the profile name, or "the user". */
export function noMistakesShippingLines(name: string): string[] {
  return [
    '## Shipping',
    [
      'This checkout has a no-mistakes gate. The `no-mistakes` command is on PATH, and git has a remote named `no-mistakes`.',
      `When you are asked to push or to open a PR, commit on this branch first. If this branch is the repository's default branch, stop and ask ${name} for a feature branch. A worktree thread stays on its \`omni/<id>\` branch. Do not run \`git checkout\` or \`git switch\`.`,
      `Drive the gate with \`no-mistakes axi\`. With the \`/no-mistakes\` skill loaded, follow that skill. With no skill loaded, start with \`no-mistakes axi run --intent "<the goal ${name} asked for>"\`. Pass the goal and the constraints ${name} set, in their words. The command blocks until a decision or the end, and it often takes several minutes. Let it finish. If your shell backgrounds it, read the result when it returns. Do not start a second run while this branch already has one.`,
      'When the output contains a `gate:`, read the findings and answer with `no-mistakes axi respond`. Use `--action fix` for an `auto-fix` finding. Stop and ask ' +
        name +
        ' about an `ask-user` finding. While a run is parked, leave the checkout alone and let the pipeline apply the fix. The gate pushes to origin and opens the PR. `git push origin` and `gh pr create` are for when ' +
        name +
        ' tells you to skip the gate.',
      '`git push no-mistakes` starts the same pipeline and returns before a PR exists. Use it when you were asked to start the gate and not wait. Say that the run started, and do not invent a PR URL.',
      'A pipeline command that reports you are already inside a validation step means this turn is the gate\'s own agent. Finish the assigned step and leave the pipeline alone.',
    ].join('\n\n'),
  ];
}
