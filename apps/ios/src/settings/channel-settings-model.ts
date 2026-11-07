import type { Channel, HarnessInfo } from '@omni/client-core';
import { CHANNEL_GLYPHS, GLYPH_PREFIX, SVG_PREFIX, type ChannelGlyph } from '@omni/shared/channel-icon.ts';
import { channelBody, channelForm, type ChannelForm, type ChannelRun } from '@omni/shared/channel-form.ts';
import { runPreselect, setsRun, type DraftRun } from '@omni/shared/draft-run.ts';
import { AUTO, asksAuto } from '@omni/shared/thread-run.ts';

import { applyPick, draftChipLabel, type DraftPick } from '../newthread/draft';

/** The body Save sends for an existing channel. The GitHub repo goes only once it was changed, so the server keeps reading it from the repo path. */
export function saveBody(form: ChannelForm, channel: Channel): Record<string, unknown> {
  return channelBody(form, { system: channel.kind === 'system', github: form.github_repo.trim() !== (channel.github_repo ?? '') });
}

/** Whether the form differs from what the server has. */
export const formDirty = (form: ChannelForm, channel: Channel) => JSON.stringify(saveBody(form, channel)) !== JSON.stringify(saveBody(channelForm(channel), channel));

/** The run the model sheet checks: the channel's default, else Auto, as the New sheet preselects it. */
export const shownRun = (run: ChannelRun, harnesses: readonly HarnessInfo[]): DraftRun => runPreselect(undefined, run, [...harnesses]);

/**
 * A pick in the model sheet as the channel's new default, the way the Web UI's picker stores it: Auto is model "auto"
 * with no harness, another model starts at its default effort, and an effort keeps the model.
 */
export function runFromPick(run: ChannelRun, harnesses: readonly HarnessInfo[], pick: DraftPick): ChannelRun {
  const next = applyPick(shownRun(run, harnesses), pick);
  if (asksAuto(next.choice)) return { harness: '', model: AUTO, effort: '' };
  return { harness: next.choice.harness, model: next.choice.model, effort: next.effort };
}

/** "Auto", or "Sonnet 5.5 · high": the default as one line. "Auto" until the catalog loads. */
export function runLabel(run: ChannelRun, harnesses: readonly HarnessInfo[] | null): string {
  if (!setsRun(run) || asksAuto(run) || !harnesses) return 'Auto';
  return draftChipLabel(shownRun(run, harnesses), harnesses) ?? 'Auto';
}

export type IconParts = { kind: 'none' } | { kind: 'emoji'; text: string } | { kind: 'glyph'; name: ChannelGlyph } | { kind: 'svg' };

/** What a stored icon is. An SVG is only uploaded from the computer; the phone shows it and can clear it. */
export function iconParts(icon: string): IconParts {
  const v = icon.trim();
  if (!v) return { kind: 'none' };
  if (v.startsWith(SVG_PREFIX)) return { kind: 'svg' };
  if (v.startsWith(GLYPH_PREFIX)) {
    const name = v.slice(GLYPH_PREFIX.length);
    return (CHANNEL_GLYPHS as readonly string[]).includes(name) ? { kind: 'glyph', name: name as ChannelGlyph } : { kind: 'none' };
  }
  return { kind: 'emoji', text: v };
}

/**
 * The emoji typed last, so typing a second one replaces the first. Without Intl.Segmenter (some Hermes builds) it keeps
 * what was typed and the server, which counts graphemes, refuses more than one.
 */
export function lastEmoji(text: string): string {
  const v = text.trim();
  if (!v) return '';
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Segmenter !== 'function') return v;
  const all = [...new Segmenter().segment(v)];
  return all[all.length - 1]?.segment ?? '';
}

/** "#acme", or "Conductor" for the Conductor's channel. */
export const channelTitle = (c: Pick<Channel, 'id' | 'name'>) => (c.id === 'conductor' ? 'Conductor' : `#${c.name}`);

/** Where a channel's threads run, as one line: its repo, its base directory, else the workspace folder. */
export const channelWhere = (c: Pick<Channel, 'repo_path' | 'base_dir'>) => c.repo_path ?? c.base_dir ?? 'Workspace folder';

/** Whether a channel can be archived: not a system channel and not the inbox, as on the Web UI. */
export const canArchive = (c: Pick<Channel, 'id' | 'kind'>) => c.kind !== 'system' && c.id !== 'inbox';
