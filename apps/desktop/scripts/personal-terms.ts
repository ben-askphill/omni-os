// Keeps one person's own setup out of what every install ships: their name, company, clients, machines, paths and
// timezone. It reads each shipped source the way the build emits it:
//   - the crew charters, job templates, mods and other text files as they are;
//   - the server, Conductor MCP, Web UI, desktop, shared, client-core, iOS and relay sources as esbuild emits them:
//     types and the comments on them drop out, other comments stay, as they do in the server bundle;
//   - the Rust crates without their comments and #[cfg(test)] modules, which the binaries never carry.
// stage.ts runs it before a release, tests/stage.test.ts runs it over the repo, and `npx tsx
// apps/desktop/scripts/personal-terms.ts` prints every hit.
//
// Optional packs that name a company on purpose live under a `packs/` folder and are skipped.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { transformSync } from 'esbuild';

/**
 * Words that mark text as one person's own, matched as whole words, case and all, so "productive" or "portal" in plain
 * prose still pass.
 */
export const PERSONAL_TERMS = [
  'Ben', 'Rosenberg', 'Ask Phill', 'APA', 'Phillbert', 'Productive', 'Portal',
  'Volero', 'Pink Gellac', 'Kamera Express', 'Acne', 'North Sails', 'Patta', 'A-dam', 'OBEY', 'Nomos',
  'Amsterdam', 'CET', 'CEST', 'central brain', 'Central brain',
] as const;

/**
 * Words that mark text as one person's own in any case: names nobody writes in plain prose, their machines, their
 * handles and their folders.
 */
export const PERSONAL_TERMS_ANY_CASE = [
  'brosenb', 'askphill', 'ask phill', 'phillbert', 'phillbot', 'volero', 'gellac', 'kamera express', 'north sails', 'poows',
  'chocolonely', 'omarchy', 'macbook pro', 'macbook air', 'central-brain', 'agent-config', 'ben@',
] as const;

/**
 * The text each install gets, from the repo root: the desktop app's server, Conductor MCP, desktop, Web UI and copied
 * folders, the Rust binaries, the iOS app, and the sync relay each user deploys.
 */
export const SHIPPED_SOURCES = [
  'apps/server', 'apps/mcp', 'apps/web/src', 'apps/web/index.html', 'apps/web/public', 'apps/desktop/src', 'apps/desktop/package.json',
  'packages/shared', 'packages/client-core', 'crew', 'templates', 'mods', 'prototypes/activity-monitor',
  'crates/omni-cli/src', 'crates/omni-core/src', 'crates/omni-mcp/src',
  'apps/ios/src', 'apps/ios/index.ts', 'apps/ios/app.config.ts', 'apps/ios/app.json', 'apps/ios/eas.json',
  'apps/relay/src', 'apps/relay/wrangler.jsonc',
] as const;

/**
 * Hits that are not anyone's own, as `file:term`. Link previews name the service a pasted link belongs to, Productive
 * among some 40 others. The desktop app's homepage is the project's own repo, the one its updates come from.
 */
export const ALLOWED_HITS = new Set([
  'packages/shared/link-source-types.ts:Productive',
  'packages/shared/link-parsers-work.ts:Productive',
  'apps/desktop/package.json:askphill',
]);

const SKIP_DIRS = new Set(['node_modules', 'tests', 'test', 'dist', 'build', 'packs', 'fixtures', 'scripts', '.turbo', 'target']);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactRe = new RegExp(`\\b(${PERSONAL_TERMS.map(escape).join('|')})\\b`, 'g');
// A term that ends in a letter ends a word; one that ends in a sign, like `ben@`, runs on into the rest.
const anyCaseRe = new RegExp(`\\b(${PERSONAL_TERMS_ANY_CASE.map((t) => escape(t) + (/\\w$/.test(t) ? '(?!\\w)' : '')).join('|')})`, 'gi');

/** The first personal term in a line of text, as written there, or null. */
export function personalTermIn(text: string): string | null {
  const hits = [...text.matchAll(exactRe), ...text.matchAll(anyCaseRe)];
  if (!hits.length) return null;
  return hits.reduce((a, b) => ((a.index ?? 0) <= (b.index ?? 0) ? a : b))[1];
}

/**
 * The text a source file ships, a line at a time: the file as esbuild emits it. `line` counts lines of that output,
 * close to the source's.
 */
export function shippedText(file: string, code: string): { line: number; text: string }[] {
  const js = transformSync(code, { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'preserve', legalComments: 'none' }).code;
  return js.split('\n').map((text, i) => ({ line: i + 1, text }));
}

/** Where a line's `//` comment starts, outside any string literal, or -1. */
function rustCommentStart(line: string): number {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '/' && line[i + 1] === '/') return i;
  }
  return -1;
}

/**
 * The text a Rust source puts in its binary, a line at a time, numbered as in the source: no comments, and nothing
 * from a `#[cfg(test)]` module (rustfmt closes a top-level one with a `}` of its own at the start of a line).
 */
export function rustShippedText(code: string): { line: number; text: string }[] {
  const lines = code.split('\n');
  const out: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#\[cfg\(test\)\]/.test(lines[i]) && /^\s*(pub\s+)?mod\s/.test(lines[i + 1] ?? '')) {
      i++;
      if (!/\{\s*$/.test(lines[i])) continue;
      while (i < lines.length && lines[i] !== '}') i++;
      continue;
    }
    const at = rustCommentStart(lines[i]);
    out.push({ line: i + 1, text: at < 0 ? lines[i] : lines[i].slice(0, at) });
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(name) ? [] : walk(p);
    return [p];
  });
}

/** The lines a file ships, read the way the build reads it. Empty for a file the checks leave alone. */
function linesOf(rel: string, code: string): { line: number; text: string }[] {
  if (/\.tsx?$/.test(rel)) return shippedText(rel, code);
  if (rel.endsWith('.rs')) return rustShippedText(code);
  if (/\.(md|json|jsonc|mjs|js|cjs|html)$/.test(rel)) return code.split('\n').map((text, i) => ({ line: i + 1, text }));
  return [];
}

/** Each shipped line under `root` that names one of the personal terms, as `<path>:<line>: <term>: <text>`. */
export function personalTermProblems(root: string, sources: readonly string[] = SHIPPED_SOURCES): string[] {
  const problems: string[] = [];
  for (const src of sources) {
    let files: string[];
    try {
      files = statSync(join(root, src)).isDirectory() ? walk(join(root, src)) : [join(root, src)];
    } catch {
      continue;
    }
    for (const f of files) {
      const rel = relative(root, f).split(sep).join('/');
      if (/\.test\.[cm]?[jt]sx?$/.test(rel) || rel.endsWith('.d.ts') || /(^|\/)vitest\.config\.[cm]?[jt]s$/.test(rel)) continue;
      for (const { line, text } of linesOf(rel, readFileSync(f, 'utf8'))) {
        const hit = personalTermIn(text);
        if (hit && !ALLOWED_HITS.has(`${rel}:${hit}`)) problems.push(`${rel}:${line}: ${hit}: ${text.trim().slice(0, 160)}`);
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = personalTermProblems(resolve(import.meta.dirname, '../../..'));
  for (const p of problems) console.log(p);
  console.log(`${problems.length} shipped line${problems.length === 1 ? '' : 's'} name one person's own setup`);
  process.exit(problems.length ? 1 : 0);
}
