import { readFileSync } from 'node:fs';
import { MENTION_PILL } from '@omni/shared/mention-pill.ts';
import { describe, expect, it } from 'vitest';

// The web draws an @mention's pill in CSS and the iOS app from @omni/shared/mention-pill.ts. This holds the CSS to the
// shared numbers, so a change to one side fails here until the other follows. The agent pill's tint has its contrast
// check in token-contrast.test.ts.
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const block = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`${selector} is missing from index.css`);
  return css.slice(at, css.indexOf('}', at));
};
const pct = (n: number) => `${Math.round(n * 100)}%`;

describe('.mention-pill', () => {
  it("draws a machine's pill with the shared gap, inset, corners and live tint", () => {
    const pill = block('.mention-pill');
    expect(pill).toContain(`gap: ${MENTION_PILL.gap}em;`);
    expect(pill).toContain(`padding: 0 ${MENTION_PILL.padX}em;`);
    expect(pill).toContain(`border-radius: ${MENTION_PILL.radius.machine}px;`);
    expect(pill).toContain(`background: color-mix(in srgb, var(--live) ${pct(MENTION_PILL.machineTint)}, transparent);`);
    expect(pill).toContain('color: var(--live-text);');
    expect(block('.mention-pill[data-selected]')).toContain(`color-mix(in srgb, var(--live) ${pct(MENTION_PILL.machineSelectedTint)}, transparent)`);
  });

  it('sizes the monitor icon as the shared pill does', () => {
    const icon = block('.mention-icon');
    expect(icon).toContain(`width: ${MENTION_PILL.icon}em;`);
    expect(icon).toContain(`height: ${MENTION_PILL.icon}em;`);
  });

  it("draws an agent's pill fully round, closer to its avatar", () => {
    const agent = block('.mention-pill-agent');
    expect(agent).toContain(`padding-left: ${MENTION_PILL.agentPadLeft}em;`);
    expect(agent).toContain(`border-radius: ${MENTION_PILL.radius.agent}px;`);
  });
});
