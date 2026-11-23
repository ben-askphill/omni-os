import { describe, expect, it } from 'vitest';
import { AGENT_PILL_TINT } from '../avatar-color.ts';
import { MENTION_PILL, mentionPillLook, mentionPillName, pillTint } from '../mention-pill.ts';

describe('mention pill', () => {
  it('drops the @ from the name, as the pill shows it after its mark', () => {
    expect(mentionPillName('@Designer')).toBe('Designer');
    expect(mentionPillName('omarchy')).toBe('omarchy');
  });

  it('tints a color as color-mix with transparent does', () => {
    expect(pillTint('#2b3bff', 0.13)).toBe('rgba(43, 59, 255, 0.13)');
    expect(pillTint('#FFF', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it("draws an agent's pill fully round, in its own color at the theme's tint, with its name in the text color", () => {
    const light = mentionPillLook({ kind: 'agent', color: '#ffa839' }, { scheme: 'light', fontSize: 15, live: '#2b3bff' });
    expect(light).toEqual({ fill: `rgba(255, 168, 57, ${AGENT_PILL_TINT.light})`, ink: 'fg', radius: 999, padLeft: 2.25, padRight: 6, gap: 3.75, mark: MENTION_PILL.avatar });
    expect(mentionPillLook({ kind: 'agent', color: '#ffa839' }, { scheme: 'dark', fontSize: 15, live: '#7280ff' }).fill).toBe(`rgba(255, 168, 57, ${AGENT_PILL_TINT.dark})`);
  });

  it("draws a machine's pill rounded, in the live blue, with an icon sized to the text", () => {
    expect(mentionPillLook({ kind: 'machine' }, { scheme: 'dark', fontSize: 15, live: '#7280ff' })).toEqual({ fill: 'rgba(114, 128, 255, 0.13)', ink: 'live', radius: 6, padLeft: 6, padRight: 6, gap: 3.75, mark: 12.75 });
  });
});
