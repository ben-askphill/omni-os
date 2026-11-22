import { agentColor, agentShape, BUILT_IN_SHAPES, type FaceAgent } from './agent-avatar.ts';
import { AGENT_PALETTE } from './avatar-color.ts';
import { parseChannelIcon, type ChannelGlyph } from './channel-icon.ts';
import { CREW_SHAPES, type CrewShapeId, type EyeState } from './crew-shapes.ts';

// An agent's identity block in Settings > Agents: one choice of what its avatar shows, so the preview is what every
// client draws (ADR 0019, How it looks; ADR 0021). A photo, an emoji, one of the shared icons or an uploaded SVG, or
// its crew character, in the shape and color its id picks unless Ben picked others. The color sits under every style
// but the photo. Pure.

/** What the avatar shows. A photo and an SVG are both an upload; the file picked says which. */
export type AvatarStyle = 'photo' | 'emoji' | 'icon' | 'svg' | 'character';

/** The sources the block offers, in its order: Character, Emoji, Icon, Upload. */
export type AvatarSource = 'character' | 'emoji' | 'icon' | 'upload';

export const AVATAR_SOURCES: readonly AvatarSource[] = ['character', 'emoji', 'icon', 'upload'];

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

/** The style an agent's avatar shows now, as the agent face reads it: an image wins, then its icon by kind, else its character. */
export function avatarStyleOf(avatar: FaceAgent['avatar'] | undefined): AvatarStyle {
  if (avatar?.image) return 'photo';
  const kind = parseChannelIcon(avatar?.icon)?.kind;
  return kind === 'glyph' ? 'icon' : kind ?? 'character';
}

const SOURCE_LABELS: Record<AvatarSource, string> = { character: 'Character', emoji: 'Emoji', icon: 'Icon', upload: 'Upload' };

/** The label each source gets. */
export const avatarSourceLabel = (source: AvatarSource): string => SOURCE_LABELS[source];

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

/** The `avatar.icon` a style saves: the stash's value for it, empty for a photo or the character. */
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

/** Each crew shape's name, as the shape picker and the source line say it. */
export const CREW_SHAPE_NAMES: Readonly<Record<CrewShapeId, string>> = {
  circle: 'Circle',
  droplet: 'Droplet',
  squircle: 'Squircle',
  'pill-wide': 'Wide pill',
  arch: 'Arch',
  tray: 'Tray',
  triangle: 'Triangle',
  'pill-tall': 'Tall pill',
  pebble: 'Pebble',
  diamond: 'Diamond',
  bubble: 'Bubble',
  cloud: 'Cloud',
  'pill-diagonal': 'Diagonal pill',
  fan: 'Fan',
  shield: 'Shield',
  bucket: 'Bucket',
};

/** An agent palette color's name (D20), or null for a color off the palette, which Settings calls Custom. */
export function agentColorName(hex: string | null | undefined): string | null {
  const c = (hex ?? '').toLowerCase();
  return AGENT_PALETTE.find((p) => p.hex === c)?.name ?? null;
}

/** What the Character source picks: a crew shape and a color, either empty for the one the id picks. */
export interface CharacterPick {
  shape?: string;
  bg?: string;
}

/**
 * The line under the preview for the Character source: a built-in in its own shape and color, a spare its id picked,
 * or the shape and color picked, by name.
 */
export function characterLine(id: string, pick: CharacterPick): string {
  const agent = { id, avatar: pick };
  const shape = agentShape(agent);
  const color = agentColor(agent).toLowerCase();
  if (Object.hasOwn(BUILT_IN_SHAPES, id) && shape === BUILT_IN_SHAPES[id] && color === CREW_SHAPES[shape].color) return 'Its crew character.';
  if (!Object.hasOwn(BUILT_IN_SHAPES, id) && !pick.shape && !pick.bg) return 'A crew character from its id.';
  const name = CREW_SHAPE_NAMES[shape].toLowerCase();
  return `${/^[aeiou]/.test(name) ? 'An' : 'A'} ${name} in ${agentColorName(color) ?? 'a custom color'}.`;
}

/** What a tile in the shape picker says: its shape's name, a short note under it, and its whole name for assistive tech. */
export interface ShapeTile {
  name: string;
  /** Built-in on the agent's own built-in shape, else the agents that show it now (the first, and how many more). */
  note: string | null;
  label: string;
}

/**
 * The tile for `shape` on agent `id`'s page, among `agents` (the crew this machine lists). An agent shows a shape when
 * its face is its character (no photo, no icon) in that shape, its id's pick included; the agent itself is left out.
 */
export function shapeTile(shape: CrewShapeId, id: string, agents: readonly (FaceAgent & { name: string })[]): ShapeTile {
  const name = CREW_SHAPE_NAMES[shape];
  const builtIn = BUILT_IN_SHAPES[id] === shape && Object.hasOwn(BUILT_IN_SHAPES, id);
  const others = agents.filter((a) => a.id !== id && !a.avatar?.image && !a.avatar?.icon && agentShape(a) === shape).map((a) => a.name);
  const list = others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}` : others[0];
  const note = builtIn ? 'Built-in' : others.length ? `${others[0]}${others.length > 1 ? ` +${others.length - 1}` : ''}` : null;
  const label = [name, builtIn && 'built-in', list && `shown by ${list}`].filter(Boolean).join(', ');
  return { name, note, label };
}

/** Each eye state's name, as the preview's still row of states says it. */
export const EYE_STATE_NAMES: Readonly<Record<EyeState, string>> = { idle: 'Idle', thinking: 'Thinking', working: 'Working', waiting: 'Waiting', needs: 'Needs you', done: 'Done' };
