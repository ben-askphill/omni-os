import { parseChannelIcon, type ChannelGlyph } from './channel-icon.ts';

// An agent's identity block in Settings > Agents: one choice of what its avatar shows, so the preview is what every
// client draws (ADR 0019, How it looks). A photo, an emoji, one of the shared icons or an uploaded SVG, or nothing of
// its own (a built-in's mark, else its initials). The background color sits under every style but the photo. Pure.

/** What the avatar shows. A photo and an SVG are both an upload; the file picked says which. */
export type AvatarStyle = 'photo' | 'emoji' | 'icon' | 'svg' | 'auto';

/** The sources the block offers, in its order: Initials (or Built-in), Emoji, Icon, Upload. */
export type AvatarSource = 'auto' | 'emoji' | 'icon' | 'upload';

export const AVATAR_SOURCES: readonly AvatarSource[] = ['auto', 'emoji', 'icon', 'upload'];

export const sourceOf = (style: AvatarStyle): AvatarSource => (style === 'photo' || style === 'svg' ? 'upload' : style);

/**
 * The style Upload picks when chosen from another source: a photo picked or saved, else an SVG it holds, else a photo
 * still to be uploaded.
 */
export function uploadStyle(v: { picked: string | null; stash: { svg: string } }, saved: string | null | undefined): AvatarStyle {
  if (v.picked || saved) return 'photo';
  return v.stash.svg ? 'svg' : 'photo';
}

/** Whether a picked file is an SVG, which becomes the icon, rather than a photo. */
export const isSvgFile = (f: { type: string; name: string }) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);

/** The style an agent's avatar shows now: an image wins, then its icon by kind, else none of its own. */
export function avatarStyleOf(avatar: { image?: string | null; icon?: string | null } | undefined): AvatarStyle {
  if (avatar?.image) return 'photo';
  const kind = parseChannelIcon(avatar?.icon)?.kind;
  return kind === 'glyph' ? 'icon' : kind ?? 'auto';
}

/** The label each source gets. `auto` names what an agent shows without one: a built-in's mark, else its initials. */
export function avatarSourceLabel(source: AvatarSource, builtInMark: boolean): string {
  return { auto: builtInMark ? 'Built-in' : 'Initials', emoji: 'Emoji', icon: 'Icon', upload: 'Upload' }[source];
}

/** What each style keeps while another one is picked, so switching back finds it again. */
export interface AvatarStash {
  emoji: string;
  glyph: string;
  svg: string;
}

/** The stash an agent's saved icon fills: its value under its own kind, the others empty. */
export function stashOf(icon: string | null | undefined): AvatarStash {
  const mark = parseChannelIcon(icon);
  return {
    emoji: mark?.kind === 'emoji' ? (icon ?? '').trim() : '',
    glyph: mark?.kind === 'glyph' ? (icon ?? '').trim() : '',
    svg: mark?.kind === 'svg' ? (icon ?? '').trim() : '',
  };
}

/** The `avatar.icon` a style saves: the stash's value for it, empty for a photo or none of its own. */
export function iconFor(style: AvatarStyle, stash: AvatarStash): string {
  if (style === 'emoji') return stash.emoji;
  if (style === 'icon') return stash.glyph;
  if (style === 'svg') return stash.svg;
  return '';
}

export const glyphOf = (icon: string): ChannelGlyph | null => {
  const mark = parseChannelIcon(icon);
  return mark?.kind === 'glyph' ? mark.name : null;
};

/**
 * What a save does to the uploaded image: `keep` it, `remove` it, or `set` the photo just picked. Any style but the
 * photo takes an image away, or it would go on hiding the icon the preview shows.
 */
export type ImageChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'set'; dataUrl: string };

export function imageChangeOf(style: AvatarStyle, saved: string | null | undefined, picked: string | null): ImageChange {
  if (style === 'photo') return picked ? { kind: 'set', dataUrl: picked } : { kind: 'keep' };
  return saved ? { kind: 'remove' } : { kind: 'keep' };
}

/** Whether the background color shows under this style: every one but the photo, which covers the whole disc. */
export const styleTakesColor = (style: AvatarStyle) => style !== 'photo';
