import { describe, expect, it } from 'vitest';
import { avatarSourceLabel, avatarStyleOf, iconFor, imageChangeOf, isSvgFile, sourceOf, stashOf, styleTakesColor, uploadStyle } from '../agent-identity.ts';

const SVG = 'svg:<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

describe('avatarStyleOf', () => {
  it('reads an image as the photo, whatever icon sits under it', () => {
    expect(avatarStyleOf({ image: '/api/crew/a/avatar?v=abcdef', icon: 'icon:zap' })).toBe('photo');
  });

  it('reads the icon by its kind, and nothing of its own as auto', () => {
    expect(avatarStyleOf({ icon: '🦊' })).toBe('emoji');
    expect(avatarStyleOf({ icon: 'icon:zap' })).toBe('icon');
    expect(avatarStyleOf({ icon: SVG })).toBe('svg');
    expect(avatarStyleOf({ icon: 'icon:not-a-glyph' })).toBe('auto');
    expect(avatarStyleOf(undefined)).toBe('auto');
  });
});

describe('stash and iconFor', () => {
  it('keeps the saved icon under its own kind, so another style can be tried and switched back', () => {
    const stash = stashOf(SVG);
    expect(stash).toEqual({ emoji: '', glyph: '', svg: SVG });
    expect(iconFor('svg', stash)).toBe(SVG);
    expect(iconFor('emoji', { ...stash, emoji: '🦊' })).toBe('🦊');
    expect(iconFor('photo', stash)).toBe('');
    expect(iconFor('auto', stash)).toBe('');
  });
});

describe('imageChangeOf', () => {
  it('sets a picked photo, keeps a saved one, and takes it away for any other style', () => {
    expect(imageChangeOf('photo', null, 'data:image/png;base64,AA')).toEqual({ kind: 'set', dataUrl: 'data:image/png;base64,AA' });
    expect(imageChangeOf('photo', '/api/crew/a/avatar?v=abcdef', null)).toEqual({ kind: 'keep' });
    expect(imageChangeOf('svg', '/api/crew/a/avatar?v=abcdef', null)).toEqual({ kind: 'remove' });
    expect(imageChangeOf('emoji', undefined, null)).toEqual({ kind: 'keep' });
  });
});

describe('Upload', () => {
  it('holds a photo and an SVG as one source, and picks the one the agent has when chosen', () => {
    expect(sourceOf('photo')).toBe('upload');
    expect(sourceOf('svg')).toBe('upload');
    expect(sourceOf('emoji')).toBe('emoji');
    expect(uploadStyle({ picked: null, stash: { svg: SVG } }, null)).toBe('svg');
    expect(uploadStyle({ picked: null, stash: { svg: SVG } }, '/api/crew/a/avatar?v=abcdef')).toBe('photo');
    expect(uploadStyle({ picked: null, stash: { svg: '' } }, null)).toBe('photo');
  });

  it('tells an SVG file from a photo by its type or name', () => {
    expect(isSvgFile({ type: 'image/svg+xml', name: 'mark' })).toBe(true);
    expect(isSvgFile({ type: '', name: 'Mark.SVG' })).toBe(true);
    expect(isSvgFile({ type: 'image/png', name: 'face.png' })).toBe(false);
  });
});

it('names auto by what the agent falls back to, and puts the color under every style but the photo', () => {
  expect(avatarSourceLabel('auto', true)).toBe('Built-in');
  expect(avatarSourceLabel('auto', false)).toBe('Initials');
  expect(styleTakesColor('photo')).toBe(false);
  expect(styleTakesColor('svg')).toBe(true);
});
