// The rules the desktop release workflow (.github/workflows/desktop-release.yml) keeps, so that no dependency's code
// runs where a signing secret or a repository write token is. tests/release-workflow.test.ts holds the workflow to them.
//
// - The workflow's own permissions are read-only, and its env holds no secret.
// - A job that runs package code (npm, npx, tsx, electron-builder) has no secret, no token and no write permission. It
//   installs with --ignore-scripts, rebuilds only REBUILD_ALLOWED, runs npx --no-install, and checks out without
//   keeping the token in .git/config.
// - A job that has a secret or can write runs no package code and uses only GitHub's own actions. The only scripts it
//   runs with node are the repo's, importing nothing but Node's built-ins and each other. It downloads each artifact
//   packed (skip-decompress), since another job made it, and checks it against a checksum before it unpacks it.
// - A job that has a secret cannot write, and only one job can write.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/** The packages whose install scripts a build job may run, by name, after `npm ci --ignore-scripts`. */
export const REBUILD_ALLOWED = ['node-pty'] as const;

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A run script without its comment lines, so a comment that names npm is not a command. */
function commands(run: unknown): string {
  if (typeof run !== 'string') return '';
  return run
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/** Each command of a script: its lines, split again at ; && || and |. */
function segments(run: string): string[] {
  return run.split(/\n|;|&&|\|\|?/).map((part) => part.trim());
}

const PACKAGE_CODE = /\b(npm|npx|pnpm|yarn|bunx?|tsx|electron-builder)\b|node_modules/;
const INSTALL = /\bnpm\s+(ci|install|i|add|isntall|clean-install|install-ci-test|it)\b/;
const REBUILD = /\bnpm\s+rebuild\b(.*)$/;
const NODE_SCRIPT = /(?:^|[\s(])node\s+((?:--?[\w-]+(?:=\S+)?\s+)*)(\S+)/g;
const CHECKSUM = /\b(shasum\s+(-a\s*256\s+)?(-c|--check)|sha256sum\s+(-c|--check))\b/;

/** True when a `permissions` value grants any write. */
function grantsWrite(permissions: unknown): boolean {
  if (permissions === 'write-all') return true;
  return isDict(permissions) && Object.values(permissions).includes('write');
}

/** True when a `permissions` value grants only read or none. A missing one takes the repository's default. */
function readOnly(permissions: unknown): boolean {
  if (permissions === 'read-all' || (isDict(permissions) && Object.keys(permissions).length === 0)) return true;
  return isDict(permissions) && Object.values(permissions).every((value) => value === 'read' || value === 'none');
}

/** The text of every `${{ }}` expression in a value, where secrets and the token are read. */
function expressions(value: unknown): string {
  return [...JSON.stringify(value ?? null).matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => match[1]).join('\n');
}

function secretsIn(value: unknown): string[] {
  const names = [...expressions(value).matchAll(/\bsecrets\s*(?:\.\s*([A-Za-z0-9_]+)|\[\s*\\?['"]([^'"\\]+))/g)].map((match) => match[1] ?? match[2]);
  return [...new Set(names)].filter((name) => name !== 'GITHUB_TOKEN');
}

function usesToken(value: unknown): boolean {
  return /\bgithub\s*\.\s*token\b|\bsecrets\s*\.\s*GITHUB_TOKEN\b/.test(expressions(value));
}

const IMPORT = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bexport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]|\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Why the repo script at `path` (relative to the repo root) may not run where a secret or a write token is, or null
 * when it may: it and every file it imports, by relative path, import nothing but `node:` built-ins.
 */
export function scriptProblem(repo: string, path: string, seen = new Set<string>()): string | null {
  const file = normalize(path);
  if (file.startsWith('..') || file.startsWith('/') || file.includes('$')) return `${path} is not a file in the repo`;
  if (seen.has(file)) return null;
  seen.add(file);
  const full = join(repo, file);
  if (!existsSync(full)) return `${path} is not a file in the repo`;
  const source = readFileSync(full, 'utf8');
  for (const match of source.matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier.startsWith('node:')) continue;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return `${file} imports ${specifier}`;
    const problem = scriptProblem(repo, join(dirname(file), specifier), seen);
    if (problem) return problem;
  }
  return null;
}

/** Each way the workflow breaks the rules above, as `<job>: <problem>`. Empty when it keeps them. */
export function workflowProblems(workflow: unknown, repo: string): string[] {
  if (!isDict(workflow)) return ['the workflow is not a YAML mapping'];
  const problems: string[] = [];
  if (!readOnly(workflow.permissions)) problems.push('workflow: its default permissions must be read-only (permissions: contents: read)');
  if (secretsIn(workflow.env).length || usesToken(workflow.env)) problems.push('workflow: its env must hold no secret or token, which every job would get');
  const jobs = isDict(workflow.jobs) ? workflow.jobs : {};
  const writers: string[] = [];
  for (const [id, job] of Object.entries(jobs)) {
    if (!isDict(job)) continue;
    const steps = (Array.isArray(job.steps) ? job.steps : []).filter(isDict);
    const scripts = steps.map((step) => commands(step.run));
    const secrets = secretsIn(job);
    const token = usesToken(job);
    const writes = job.permissions === undefined ? grantsWrite(workflow.permissions) || workflow.permissions === undefined : grantsWrite(job.permissions);
    const packageCode = scripts.some((run) => PACKAGE_CODE.test(run));
    if (writes) writers.push(id);
    const say = (problem: string) => problems.push(`${id}: ${problem}`);

    if (packageCode) {
      if (secrets.length) say(`runs package code with secrets ${secrets.join(', ')}`);
      if (token) say('runs package code with the GitHub token');
      if (writes) say('runs package code with write permissions');
      for (const step of steps) {
        if (typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@') && (!isDict(step.with) || step.with['persist-credentials'] !== false)) {
          say('checks out with the token kept in .git/config (set persist-credentials: false)');
        }
      }
      for (const part of scripts.flatMap(segments)) {
        if (INSTALL.test(part) && !/--ignore-scripts(=true)?(\s|$)/.test(part)) say(`installs with dependencies' install scripts on: ${part}`);
        const rebuild = REBUILD.exec(part);
        if (rebuild) {
          const names = rebuild[1].split(/\s+/).filter((word) => word && !word.startsWith('-'));
          const extra = names.filter((name) => !(REBUILD_ALLOWED as readonly string[]).includes(name));
          if (names.length === 0 || extra.length) say(`rebuilds more than ${REBUILD_ALLOWED.join(', ')}: ${part}`);
        }
        if (/\bnpx\b/.test(part) && !/\bnpx\s+--no-install\b/.test(part)) say(`can fetch a package that is not installed (use npx --no-install): ${part}`);
      }
    }

    if (secrets.length && writes) say(`has secrets ${secrets.join(', ')} and write permissions`);

    if (secrets.length || writes) {
      for (const step of steps) {
        if (typeof step.uses === 'string' && !step.uses.startsWith('actions/')) say(`has secrets or write permissions and runs ${step.uses}`);
      }
      for (const run of scripts) {
        for (const match of run.matchAll(NODE_SCRIPT)) {
          const problem = scriptProblem(repo, match[2]);
          if (problem) say(`has secrets or write permissions and runs node on ${problem}`);
        }
      }
      steps.forEach((step, i) => {
        if (typeof step.uses !== 'string' || !step.uses.startsWith('actions/download-artifact@')) return;
        if (!isDict(step.with) || step.with['skip-decompress'] !== true) {
          say('lets actions/download-artifact unpack an artifact another job made (set skip-decompress: true)');
        }
        if (!scripts.slice(i + 1).some((run) => CHECKSUM.test(run))) say('takes an artifact without checking it against a checksum');
      });
    }
  }
  if (writers.length > 1) problems.push(`workflow: only one job may write, and ${writers.join(', ')} can`);
  return problems;
}
