import { describe, expect, it } from 'vitest';
import { itemForKey, type MenuItem } from '../src/components/ContextMenuParts.tsx';

const item = (label: string, keys: string[], off?: string): MenuItem => ({ label, icon: 'pin', keys, off, run: () => {} });
const groups = [{ items: [item('Open in new window', ['⌘', '↵'])] }, { items: [item('Pin thread', ['P']), item('Reference a thread', ['@']), item('Fork thread', ['F'], 'Not on this machine')] }];
const press = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) =>
  itemForKey(groups, { key, metaKey: false, ctrlKey: false, altKey: false, ...mods }, '⌘')?.label;

describe('context menu keys', () => {
  it('runs the item a row shows the key for, in either case', () => {
    expect(press('p')).toBe('Pin thread');
    expect(press('P')).toBe('Pin thread');
    expect(press('@')).toBe('Reference a thread');
    expect(press('Enter', { metaKey: true })).toBe('Open in new window');
  });

  it('runs nothing for an item that cannot run, an unknown key, or a key with Option', () => {
    expect(press('f')).toBeUndefined();
    expect(press('x')).toBeUndefined();
    expect(press('p', { altKey: true })).toBeUndefined();
    expect(press('p', { metaKey: true })).toBeUndefined();
    expect(press('Enter')).toBeUndefined();
  });
});
