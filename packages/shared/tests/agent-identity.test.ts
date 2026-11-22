import { describe, expect, it } from 'vitest';
import { AVATAR_SOURCES, avatarSourceLabel, characterLine, shapeTile, avatarStyleOf, iconFor, imageChangeOf, isSvgFile, sourceOf, stashOf, styleTakesColor, uploadStyle } from '../agent-identity.ts';

const SVG = 'svg:<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

describe('avatarStyleOf', () => {
  it('reads an image as the photo, whatever icon sits under it', () => {
    expect(avatarStyleOf({ image: '/api/crew/a/avatar?v=abcdef', icon: 'icon:zap' })).toBe('photo');
  });

  it('reads the icon by its kind, and nothing of its own (a shape and a color included) as its character', () => {
    expect(avatarStyleOf({ icon: '🦊' })).toBe('emoji');
    expect(avatarStyleOf({ icon: 'icon:zap' })).toBe('icon');
    expect(avatarStyleOf({ icon: SVG })).toBe('svg');
    expect(avatarStyleOf({ icon: 'icon:not-a-glyph' })).toBe('character');
    expect(avatarStyleOf({ shape: 'fan', bg: '#feb98b' })).toBe('character');
    expect(avatarStyleOf(undefined)).toBe('character');
  });
});

describe('stash and iconFor', () => {
  it('keeps the saved icon under its own kind, so another style can be tried and switched back', () => {
    const stash = stashOf(SVG);
    expect(stash).toEqual({ emoji: '', glyph: '', svg: SVG });
    expect(iconFor('svg', stash)).toBe(SVG);
    expect(iconFor('emoji', { ...stash, emoji: '🦊' })).toBe('🦊');
    expect(iconFor('photo', stash)).toBe('');
    expect(iconFor('character', stash)).toBe('');
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

it('offers Character first, then Emoji, Icon and Upload, and puts the color under every style but the photo', () => {
  expect(AVATAR_SOURCES.map(avatarSourceLabel)).toEqual(['Character', 'Emoji', 'Icon', 'Upload']);
  expect(styleTakesColor('photo')).toBe(false);
  expect(styleTakesColor('svg')).toBe(true);
  expect(styleTakesColor('character')).toBe(true);
});

describe('characterLine', () => {
  it("says a built-in shows its own crew character in its own pair, picked again or left to its id", () => {
    expect(characterLine('builder', {})).toBe('Its crew character.');
    expect(characterLine('builder', { shape: 'squircle', bg: '#ffa839' })).toBe('Its crew character.');
    expect(characterLine('store-ops', {})).toBe('Its crew character.');
  });

  it('says any other agent shows a crew character from its id until a shape or a color is picked', () => {
    expect(characterLine('designer', {})).toBe('A crew character from its id.');
    expect(characterLine('designer', { shape: 'fan', bg: '#feb98b' })).toBe('A fan in Peach.');
    expect(characterLine('builder', { shape: 'arch' })).toBe('An arch in Rose.');
    expect(characterLine('builder', { bg: '#123456' })).toBe('A squircle in a custom color.');
    expect(characterLine('builder', { shape: 'pill-wide', bg: '#52CDFE' })).toBe('A wide pill in Sky.');
  });
});

describe('shapeTile', () => {
  const crew = [
    { id: 'builder', name: 'Builder' },
    { id: 'designer', name: 'Designer' },
    { id: 'writer', name: 'Writer', avatar: { shape: 'bucket' } },
    { id: 'scout', name: 'Scout', avatar: { shape: 'bucket', bg: '#0093e4' } },
    // An icon shows instead of its droplet.
    { id: 'researcher', name: 'Researcher', avatar: { icon: 'icon:zap' } },
  ];

  it("says Built-in on a built-in's own shape, and names the other agents a shape shows on", () => {
    expect(shapeTile('squircle', 'builder', crew)).toEqual({ name: 'Squircle', note: 'Built-in', label: 'Squircle, built-in' });
    expect(shapeTile('squircle', 'designer', crew)).toEqual({ name: 'Squircle', note: 'Builder', label: 'Squircle, shown by Builder' });
    // Designer's own row is left out; the two that picked its bucket are named.
    expect(shapeTile('bucket', 'designer', crew)).toEqual({ name: 'Bucket', note: 'Writer +1', label: 'Bucket, shown by Writer and Scout' });
    expect(shapeTile('droplet', 'designer', crew)).toEqual({ name: 'Droplet', note: null, label: 'Droplet' });
  });
});
