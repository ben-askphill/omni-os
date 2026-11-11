import { describe, it, expect } from 'vitest';
import { autoAvatarColor, avatarInk, contrast, contrastingColor, hexColor, resolveAvatarColor, svgColors } from '../avatar-color.ts';

describe('avatar colors', () => {
  it('normalizes literal colors and rejects non-opaque paint', () => {
    expect(hexColor('#abc')).toBe('#aabbcc');
    expect(hexColor('rgb(10, 20, 30)')).toBe('#0a141e');
    expect(hexColor('red')).toBe('#ff0000');
    for (const value of ['none', 'transparent', 'url(#paint)', '#1234', 'rgb(999, 0, 0)']) expect(hexColor(value)).toBeNull();
  });
  it('finds full bleed backgrounds and an SVG palette', () => {
    expect(svgColors('<svg viewBox="0 0 20 20"><rect width="20" height="20" fill="#abc"/><path fill="red"/></svg>')).toEqual({ background: '#aabbcc', palette: ['#aabbcc', '#ff0000'], foreground: '#ff0000' });
    expect(svgColors('<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" style="fill: blue"/></svg>').background).toBe('#0000ff');
    expect(svgColors('<svg viewBox="0 0 20 20"><rect width="2" height="2" fill="red"/></svg>').background).toBeNull();
  });
  it('inherits group paint, ignores definitions and does not turn transparent rects black', () => {
    expect(svgColors('<svg viewBox="0 0 20 20"><defs><rect width="20" height="20" fill="red"/></defs><g fill="white"><path d="M0 0h1"/></g></svg>').foreground).toBe('#ffffff');
    expect(svgColors('<svg viewBox="0 0 20 20"><rect width="20" height="20" fill="none"/><path fill="red"/></svg>').background).toBeNull();
  });
  it('uses a foreground rather than treating a glyph fill as its background', () => {
    const icon = 'svg:<svg viewBox="0 0 24 24"><path fill="#ffffff" d="M0 0h5v5z"/></svg>';
    expect(contrast(autoAvatarColor(icon, () => 0)!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(autoAvatarColor(null)).toBeNull();
    expect(autoAvatarColor('svg:<svg viewBox="0 0 10 10"><rect width="100%" height="100%" fill="red"/></svg>')).toBe('#ff0000');
  });
  it('checks WCAG contrast and chooses random eligible swatches', () => {
    expect(contrast('#000000', '#ffffff')).toBe(21);
    for (const foreground of ['#202020', '#ffffff', '#ff0000', '#777777']) for (const r of [0, 0.5, 0.999]) expect(contrast(contrastingColor(foreground, () => r), foreground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastingColor('#202020', () => 0)).not.toBe(contrastingColor('#202020', () => 0.9));
    expect(contrast(avatarInk('#283c62'), '#283c62')).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps manual choices across avatar changes and does not reroll unrelated writes', () => {
    const current = { icon: '🌻', avatar_bg: '#123456', avatar_bg_manual: 1 };
    expect(resolveAvatarColor({ icon: '🍋' }, current)).toEqual({ icon: '🍋' });
    expect(resolveAvatarColor({}, { ...current, avatar_bg_manual: 0 })).toEqual({});
    expect(resolveAvatarColor({ avatar_bg_manual: 0 }, current).avatar_bg).not.toBe('#123456');
    expect(resolveAvatarColor({ avatar_bg: '#abcdef' }, current).avatar_bg_manual).toBe(1);
    expect(resolveAvatarColor({ avatar_bg: '#abcdef', avatar_bg_manual: 0 }, current)).toMatchObject({ avatar_bg: '#abcdef', avatar_bg_manual: 0 });
    expect(resolveAvatarColor({ icon: '🍋' }, { ...current, avatar_bg_manual: 0 }).avatar_bg).toMatch(/^#[\da-f]{6}$/);
  });
});
