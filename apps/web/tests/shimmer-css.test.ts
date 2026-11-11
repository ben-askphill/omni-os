import { readFileSync } from 'node:fs';
import { SHIMMER_EASING, SHIMMER_FROM, SHIMMER_MS, SHIMMER_SIZE, SHIMMER_STOPS, SHIMMER_TO } from '@omni/shared/shimmer.ts';
import { describe, expect, it } from 'vitest';

// The web draws the thinking line's shimmer in CSS and the iOS app from @omni/shared/shimmer.ts. This holds the CSS to
// the shared spec, so a change to one side fails here until the other follows.
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const block = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`${selector} is missing from index.css`);
  return css.slice(at, css.indexOf('\n}', at));
};
const pct = (n: number) => `${Math.round(n * 100)}%`;

describe('.shimmer-text', () => {
  const rule = block('.shimmer-text');

  it('sweeps for the shared duration on the shared easing', () => {
    expect(rule).toMatch(new RegExp(`animation: omni-shimmer ${SHIMMER_MS / 1000}s var\\(--ease-fluid\\) infinite;`));
    expect(css).toContain(`--ease-fluid: cubic-bezier(${SHIMMER_EASING.join(', ')});`);
  });

  it('sizes and starts the gradient where the spec does', () => {
    expect(rule).toContain(`${pct(SHIMMER_FROM)} 0 / ${pct(SHIMMER_SIZE)} 100%;`);
    // The iOS drawing tiles the gradient because CSS repeats it.
    expect(rule).not.toMatch(/no-repeat|background-repeat/);
    const keyframes = block('@keyframes omni-shimmer');
    expect(keyframes).toMatch(new RegExp(`from \\{\\s*background-position: ${pct(SHIMMER_FROM)} 0;`));
    expect(keyframes).toMatch(new RegExp(`to \\{\\s*background-position: ${pct(SHIMMER_TO)} 0;`));
  });

  it('has the shared stops, in order, with the same mixes', () => {
    const expected = SHIMMER_STOPS.map((s) =>
      s.mix ? `color-mix(in srgb, var(--fg-${s.mix.of.slice(2)}) ${s.mix.pct}%, var(--vermilion)) ${pct(s.offset)}` : `var(--${s.of === 'fg4' ? 'fg-4' : 'vermilion'}) ${pct(s.offset)}`,
    );
    const gradient = /linear-gradient\(\s*90deg,([\s\S]*?)\)\s*\n\s*\d/.exec(rule)?.[1];
    expect(gradient?.split(/,\n/).map((s) => s.trim())).toEqual(expected);
  });
});
