import { describe, expect, it } from 'vitest';
import { artifactOpenTargets, artifactPreview, claudeAppLink, gridColumns, GRID_MIN_CARD, parseLayout } from '../claude-artifacts.ts';

const SHORT = 'https://claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a';
const CODE = 'https://claude.ai/code/artifact/f7567ad1-8b55-4689-b824-1a865c7fe003';

describe('claudeAppLink', () => {
  it('maps both link forms to the path the Claude app handles', () => {
    expect(claudeAppLink(SHORT)).toBe('claude://claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a');
    expect(claudeAppLink(CODE)).toBe('claude://claude.ai/artifact/f7567ad1-8b55-4689-b824-1a865c7fe003');
    expect(claudeAppLink(`${SHORT}/`)).toBe('claude://claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a');
  });

  it('keeps https for links the app would drop or that are not artifacts', () => {
    for (const url of [
      `${SHORT}?foo=1`,
      `${SHORT}#x`,
      'https://user@claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a',
      'http://claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a',
      'https://claude.ai.evil.com/artifact/XYTPbBk9xkJor7Xz1DtD2a',
      'https://evil.com/claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a',
      'https://claude.ai:8443/artifact/XYTPbBk9xkJor7Xz1DtD2a',
      'https://claude.ai/code/artifacts',
      'https://claude.ai/artifact/',
      'https://claude.ai/artifact/a/b',
      'https://claude.ai/chat/123',
      'not a url',
      '',
    ]) {
      expect(claudeAppLink(url), url).toBeNull();
    }
  });
});

describe('artifactOpenTargets', () => {
  it('tries the Claude app first in the desktop app when it is installed, then https', () => {
    expect(artifactOpenTargets(SHORT, 'desktop', true)).toEqual(['claude://claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a', SHORT]);
  });

  it('opens https when the desktop app found no Claude app', () => {
    expect(artifactOpenTargets(SHORT, 'desktop', false)).toEqual([SHORT]);
    expect(artifactOpenTargets(SHORT, 'desktop')).toEqual([SHORT]);
  });

  it('keeps https on iOS and in a browser, whatever is installed', () => {
    expect(artifactOpenTargets(SHORT, 'ios', true)).toEqual([SHORT]);
    expect(artifactOpenTargets(SHORT, 'web', true)).toEqual([SHORT]);
  });

  it('opens a link that is not an artifact as it is', () => {
    expect(artifactOpenTargets('https://example.com/x', 'desktop', true)).toEqual(['https://example.com/x']);
  });
});

describe('layout', () => {
  it('reads a saved layout and falls back to the list', () => {
    expect(parseLayout('grid')).toBe('grid');
    expect(parseLayout('list')).toBe('list');
    expect(parseLayout(null)).toBe('list');
    expect(parseLayout('tiles')).toBe('list');
    expect(parseLayout(3)).toBe('list');
  });

  it('fits two cards on a phone and more as the width grows', () => {
    expect(gridColumns(390 - 32, GRID_MIN_CARD.compact, 10)).toBe(2);
    expect(gridColumns(320 - 32, GRID_MIN_CARD.compact, 10)).toBe(1);
    expect(gridColumns(820 - 32, GRID_MIN_CARD.compact, 10)).toBe(4);
    expect(gridColumns(896, GRID_MIN_CARD.wide, 16)).toBe(3);
    expect(gridColumns(0, 150, 10)).toBe(1);
    expect(gridColumns(Number.NaN, 150, 10)).toBe(1);
  });
});

describe('artifactPreview', () => {
  const local = { artifact_id: 7, thread_id: 't', thread_title: 'T', channel_id: 'c' };

  it('shows the local file when an Omni thread published a page or image', () => {
    expect(artifactPreview({ type: 'page', local: { ...local, kind: 'html', updated_at: '2026-11-09 10:00:00' } })).toEqual({
      kind: 'local',
      artifact_id: 7,
      file_kind: 'html',
      updated_at: '2026-11-09 10:00:00',
    });
    expect(artifactPreview({ type: null, local: { ...local, kind: 'image', updated_at: 'x' } }).kind).toBe('local');
  });

  it('falls back to the type drawing otherwise, never a claude.ai fetch', () => {
    expect(artifactPreview({ type: 'slides', local: null })).toEqual({ kind: 'type', type: 'slides' });
    expect(artifactPreview({ type: 'docs', local: { ...local, kind: 'markdown', updated_at: 'x' } })).toEqual({ kind: 'type', type: 'docs' });
    // An older server sends no kind.
    expect(artifactPreview({ type: 'page', local })).toEqual({ kind: 'type', type: 'page' });
  });
});
