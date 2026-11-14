import type { Channel } from '@omni/client-core';
import { channelForm } from '@omni/shared/channel-form.ts';
import { describe, expect, it } from 'vitest';

import { canArchive, formDirty, iconParts, lastEmoji, runFromPick, runLabel, saveBody } from '../../src/settings/channel-settings-model';
import { catalog } from '../thread/fixtures';

const harnesses = catalog();

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: 'acme',
  name: 'Acme',
  kind: 'client',
  repo_path: '/code/acme',
  github_repo: 'acme/theme',
  use_worktree: 1,
  base_dir: null,
  store_domain: null,
  portal_slug: null,
  browser_headless: 1,
  notes: null,
  icon: null,
  default_harness: null,
  default_model: null,
  default_effort: null,
  worktree_include: null,
  worktree_shared: null,
  design_system_name: null,
  design_system_size: 0,
  archived: 0,
  created_at: '2026-11-01T00:00:00Z',
  ...over,
});

describe('saving channel settings', () => {
  it('is clean until a field changes, and sends what the Web UI sends', () => {
    const c = channel();
    const form = channelForm(c);
    expect(formDirty(form, c)).toBe(false);
    const edited = { ...form, notes: 'Shopify theme', showBrowser: true };
    expect(formDirty(edited, c)).toBe(true);
    expect(saveBody(edited, c)).toMatchObject({ notes: 'Shopify theme', browser_headless: 0, kind: 'client' });
  });

  it('sends the worktree lists one entry per line, and is clean again once they read back', () => {
    const c = channel({ worktree_shared: 'node_modules' });
    const form = channelForm(c);
    expect(form.worktree_shared).toBe('node_modules');
    expect(formDirty(form, c)).toBe(false);
    const edited = { ...form, worktree_include: '.env\n\nshopify.theme.toml\n' };
    expect(formDirty(edited, c)).toBe(true);
    expect(saveBody(edited, c)).toMatchObject({ worktree_include: '.env\nshopify.theme.toml', worktree_shared: 'node_modules' });
  });

  it('sends the GitHub repo only once it changed, so the server keeps reading it from the path', () => {
    const c = channel();
    expect(saveBody(channelForm(c), c)).not.toHaveProperty('github_repo');
    expect(saveBody({ ...channelForm(c), github_repo: 'acme/other' }, c).github_repo).toBe('acme/other');
  });

  it('leaves the kind out for a system channel, and never archives one', () => {
    const conductor = channel({ id: 'conductor', kind: 'system' });
    expect(saveBody(channelForm(conductor), conductor)).not.toHaveProperty('kind');
    expect(canArchive(conductor)).toBe(false);
    expect(canArchive(channel({ id: 'inbox' }))).toBe(false);
    expect(canArchive(channel())).toBe(true);
  });
});

describe('the default model', () => {
  const none = { harness: '', model: '', effort: '' };

  it('reads Auto with no default, and names a set one with its effort', () => {
    expect(runLabel(none, harnesses)).toBe('Auto');
    expect(runLabel({ harness: '', model: 'auto', effort: '' }, harnesses)).toBe('Auto');
    expect(runLabel({ harness: 'claude', model: 'opus', effort: 'low' }, harnesses)).toBe('Opus 5.5 · low');
  });

  it('stores picks the way the Web UI picker does', () => {
    expect(runFromPick(none, harnesses, 'auto')).toEqual({ harness: '', model: 'auto', effort: '' });
    const opus = runFromPick(none, harnesses, { harness: 'claude', model: 'opus' });
    expect(opus).toEqual({ harness: 'claude', model: 'opus', effort: '' });
    expect(runFromPick(opus, harnesses, { effort: 'high' })).toEqual({ harness: 'claude', model: 'opus', effort: 'high' });
    expect(runFromPick({ ...opus, effort: 'high' }, harnesses, { harness: 'codex', model: 'gpt' })).toEqual({ harness: 'codex', model: 'gpt', effort: '' });
  });
});

describe('the icon', () => {
  it('tells an emoji, an icon, an SVG and none apart', () => {
    expect(iconParts('')).toEqual({ kind: 'none' });
    expect(iconParts('🍋')).toEqual({ kind: 'emoji', text: '🍋' });
    expect(iconParts('icon:hash')).toEqual({ kind: 'glyph', name: 'hash' });
    expect(iconParts('icon:nope')).toEqual({ kind: 'none' });
    expect(iconParts('svg:<svg></svg>')).toEqual({ kind: 'svg' });
  });

  it('keeps the emoji typed last', () => {
    expect(lastEmoji('🍋🍊')).toBe('🍊');
    expect(lastEmoji('👩‍💻')).toBe('👩‍💻');
    expect(lastEmoji('  ')).toBe('');
  });
});
