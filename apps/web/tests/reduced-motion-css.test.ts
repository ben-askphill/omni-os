import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Reduced motion is handled rule by rule in index.css (M20 in docs/reviews/2026-11-19-modern-web-audit.md): movement
// stops, while fades, the search-hit flash and the undo fuse keep playing.
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

/** The body of every `@media <query> {` block, matched brace for brace. */
function blocks(query: string): { at: number; body: string }[] {
  const out: { at: number; body: string }[] = [];
  const head = `@media ${query} {`;
  for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + 1)) {
    let depth = 0;
    let i = at + head.length - 1;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    out.push({ at, body: css.slice(at + head.length, i) });
  }
  return out;
}
const reduce = blocks('(prefers-reduced-motion: reduce)');
const noPreference = blocks('(prefers-reduced-motion: no-preference)');

/** Every `@keyframes name { ... }` in `text`, with its offset. */
function keyframes(text: string, offset = 0): { name: string; at: number; body: string }[] {
  const out: { name: string; at: number; body: string }[] = [];
  for (const m of text.matchAll(/@keyframes ([\w-]+) \{/g)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) break;
    }
    out.push({ name: m[1], at: offset + m.index, body: text.slice(m.index + m[0].length, i) });
  }
  return out;
}
const inReduce = reduce.flatMap((b) => keyframes(b.body, b.at));
const inNoPreference = noPreference.flatMap((b) => keyframes(b.body, b.at));
const base = keyframes(css).filter((k) => !inReduce.some((r) => r.at === k.at) && !inNoPreference.some((r) => r.at === k.at));
const moves = (body: string) => /transform:(?!\s*translate\(-50%, 0\))|translate:|scale\(|rotate/.test(body);

describe('reduced motion in index.css', () => {
  it('has no rule for every element', () => {
    for (const { body } of reduce) {
      expect(body).not.toMatch(/(^|[\s,}])\*\s*[,{]/);
      expect(body).not.toMatch(/(^|[\s,}])::?(before|after)\s*[,{]/);
      expect(body).not.toContain('!important');
    }
  });

  it('keeps the search-hit flash', () => {
    for (const { body } of reduce) {
      expect(body).not.toMatch(/\.flash\b/);
      expect(body).not.toContain('omni-flash');
    }
    expect(base.find((k) => k.name === 'omni-flash')?.body).toMatch(/background-color/);
  });

  it('keeps the undo fuse as a countdown that fades instead of shrinking', () => {
    const fuse = inReduce.find((k) => k.name === 'say-burn');
    expect(fuse).toBeDefined();
    expect(fuse!.body.match(/width: 100%/g)).toHaveLength(2);
    expect(fuse!.body).toMatch(/to \{[^}]*opacity: 0;/);
    expect(fuse!.at).toBeGreaterThan(base.find((k) => k.name === 'say-burn')!.at);
  });

  it('gives every moving entrance a fade-only version that comes after it', () => {
    // Loops that stop outright, and the stack's slides, which only play with no preference set.
    const stopped: Record<string, string> = { 'omni-pulse': '.pulse', 'omni-ping': '.ping', 'omni-load': '.load-bar', 'omni-write': '.wordmark-line' };
    const still = reduce.map((b) => b.body).join('\n');
    for (const k of base.filter((k) => moves(k.body) && !k.name.startsWith('mo-vt-'))) {
      if (stopped[k.name]) {
        expect(still, k.name).toContain(stopped[k.name]);
        continue;
      }
      const quiet = inReduce.filter((r) => r.name === k.name);
      expect(quiet.length, `${k.name} has no reduced-motion version`).toBeGreaterThan(0);
      for (const q of quiet) {
        expect(q.at, `${k.name}'s reduced version must follow it: the last @keyframes of a name wins`).toBeGreaterThan(k.at);
        expect(moves(q.body), `${k.name}'s reduced version still moves`).toBe(false);
        expect(q.body).toContain('opacity: 0');
      }
    }
    expect(still).toMatch(/\.pulse,\s*\.ping,\s*\.breathe,\s*\.load-bar,\s*\.shimmer-text,[^{]*\{\s*animation: none;/);
  });

  it('slides the phone stack only when motion is fine, and cross-fades it otherwise', () => {
    const slides = noPreference.map((b) => b.body).join('\n');
    for (const name of ['mo-vt-over-in', 'mo-vt-over-out', 'mo-vt-under-in', 'mo-vt-under-out']) {
      expect(slides).toContain(`animation-name: ${name};`);
      expect(css.replace(slides, '')).not.toContain(`animation-name: ${name};`);
    }
    expect(css).toMatch(/::view-transition \{\s*pointer-events: none;/);
    expect(reduce.some((b) => /::view-transition-group\(root\) \{\s*animation-duration: 200ms;/.test(b.body))).toBe(true);
  });
});
