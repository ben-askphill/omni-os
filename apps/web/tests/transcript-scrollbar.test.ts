import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The desktop thread transcript scrolls with no visible bar (Ben's call, #652). The modern web audit's M24 brought a
// thin one back (#854), drawn right against the quick card. thread-find-browser.test.ts checks the same in Chromium,
// where a real transcript also has to scroll with the wheel.

const SRC = join(import.meta.dirname, '../src');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

/** The body of the first `selector {` rule in index.css. */
function rule(css: string, selector: string) {
  const at = css.indexOf(`\n  ${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('the desktop transcript has no visible scrollbar', () => {
  it('scrolls in .scroll-none, not .scroll-thin', () => {
    const scroller = read('pages/Thread.tsx').match(/<div ref=\{scrollRef\}[^>]*>/)?.[0];
    expect(scroller, 'the transcript scroller').toBeTruthy();
    const classes = scroller!.match(/className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    expect(classes).toContain('scroll-none');
    expect(classes).toContain('overflow-y-auto');
    expect(classes).not.toContain('scroll-thin');
  });

  it('.scroll-none hides the bar in every engine and keeps the box scrollable', () => {
    const css = read('index.css');
    const none = rule(css, '.scroll-none');
    expect(none).toMatch(/scrollbar-width:\s*none/);
    // Hiding by overflow would stop the wheel and trackpad too.
    expect(none).not.toMatch(/overflow/);
    // Safari before 18.2 has no scrollbar-width.
    expect(rule(css, '.scroll-none::-webkit-scrollbar')).toMatch(/display:\s*none/);
  });
});
