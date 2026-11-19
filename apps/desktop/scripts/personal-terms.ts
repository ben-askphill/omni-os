// Keeps one person's names out of what every install ships: the crew charters, job templates and mods (as text), and the text in
// the server, Conductor MCP, Web UI, desktop and shared sources as esbuild emits them: types and the comments on them
// drop out, other comments stay, as they do in the server bundle. stage.ts runs it before a release, and
// tests/stage.test.ts runs it over the repo.
//
// Optional packs that name a company on purpose live under a `packs/` folder and are skipped.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { transformSync } from 'esbuild';

/**
 * Words that mark text as one person's own: their name, company, clients and tools. Matched as whole words, case
 * and all, so "productive" or "portal" in plain prose still pass.
 */
export const PERSONAL_TERMS = [
  'Ben', 'Rosenberg', 'brosenb', 'Ask Phill', 'askphill', 'APA', 'Phillbert', 'Productive', 'Portal',
  'Volero', 'Pink Gellac', 'Kamera Express', 'Acne Studios', 'North Sails', 'Patta', 'central brain', 'Central brain',
] as const;

/** The source folders whose text goes into the default build, from the repo root. */
export const SHIPPED_SOURCES = ['apps/server', 'apps/mcp', 'apps/web/src', 'apps/desktop/src', 'packages/shared', 'crew', 'templates', 'mods'] as const;

/**
 * Hits that are a third party's product name, not anyone's own: `file:term`. Link previews name the service a
 * pasted link belongs to, Productive among some 40 others.
 */
export const ALLOWED_HITS = new Set(['packages/shared/link-source-types.ts:Productive', 'packages/shared/link-parsers-work.ts:Productive']);

const SKIP_DIRS = new Set(['node_modules', 'tests', 'test', 'dist', 'build', 'packs', 'fixtures', 'scripts', '.turbo']);
const termRe = () => new RegExp(`\\b(${PERSONAL_TERMS.join('|')})\\b`);

/**
 * The text a source file ships, a line at a time: the file as esbuild emits it. `line` counts lines of that output,
 * close to the source's.
 */
export function shippedText(file: string, code: string): { line: number; text: string }[] {
  const js = transformSync(code, { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'preserve', legalComments: 'none' }).code;
  return js.split('\n').map((text, i) => ({ line: i + 1, text }));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(name) ? [] : walk(p);
    return [p];
  });
}

/** Each shipped line under `root` that names one of PERSONAL_TERMS, as `<path>:<line>: <term>`. */
export function personalTermProblems(root: string, sources: readonly string[] = SHIPPED_SOURCES): string[] {
  const term = termRe();
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
      if (/\.test\.tsx?$/.test(rel) || rel.endsWith('.d.ts')) continue;
      const code = readFileSync(f, 'utf8');
      const texts = /\.tsx?$/.test(rel)
        ? shippedText(rel, code)
        : /\.(md|json|mjs|js)$/.test(rel)
          ? code.split('\n').map((text, i) => ({ line: i + 1, text }))
          : [];
      for (const { line, text } of texts) {
        const hit = text.match(term);
        if (hit && !ALLOWED_HITS.has(`${rel}:${hit[1]}`)) problems.push(`${rel}:${line}: ${hit[1]}: ${text.trim().slice(0, 160)}`);
      }
    }
  }
  return problems;
}
