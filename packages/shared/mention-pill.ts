// How an @mention looks inline, in a sent or queued message and in the Web UI's composer: a pill with a machine's
// monitor icon or an agent's avatar, then the name. The Web UI draws it in CSS (index.css .mention-pill,
// .mention-pill-agent and .mention-icon; apps/web/tests/mention-pill-css.test.ts holds them to these numbers) and the
// iOS app from these numbers (components/MentionText.tsx), so the two stay the same pill.
import { AGENT_PILL_TINT, hexColor } from './avatar-color.ts';

/** The pill's measurements. Lengths in em are of the text around the pill, so it scales with it; px are fixed. */
export const MENTION_PILL = {
  /** Between the icon or avatar and the name, in em. */
  gap: 0.25,
  /** Each side's inset, in em. */
  padX: 0.4,
  /** An agent pill's inset before its round avatar, in em: the avatar sits close to the pill's round end. */
  agentPadLeft: 0.15,
  /** A machine pill's monitor icon, in em, and its stroke on the 24-unit drawing. */
  icon: 0.85,
  iconStroke: 2,
  /** An agent pill's avatar, in px. */
  avatar: 16,
  /** Corner radius in px: a machine's pill is rounded, an agent's fully round. */
  radius: { machine: 6, agent: 999 },
  /** How much of the live blue a machine pill's fill takes over what is under it; selected in the composer, twice that. */
  machineTint: 0.13,
  machineSelectedTint: 0.26,
  /** How much of the agent's own color an agent pill's fill takes, per theme (avatar-color.ts). */
  agentTint: AGENT_PILL_TINT,
} as const;

/** A pill's name: the mention's text without its `@`, as the pill shows it after the icon or avatar. */
export const mentionPillName = (text: string) => (text.startsWith('@') ? text.slice(1) : text);

/** A color at `alpha` over whatever is under it, as the web's `color-mix(in srgb, <color> N%, transparent)` draws it. */
export function pillTint(color: string, alpha: number): string {
  const hex = hexColor(color) ?? '#000000';
  return `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')}, ${alpha})`;
}

/** What a native client draws for one pill, in points for text of `fontSize`: the web's pill from the same numbers. */
export interface MentionPillLook {
  /** The fill: the agent's color or the live blue, tinted. */
  fill: string;
  /** The name's color, and a machine's icon: the text color in an agent's pill, the live blue in a machine's. */
  ink: 'fg' | 'live';
  radius: number;
  padLeft: number;
  padRight: number;
  gap: number;
  /** The icon's size, or the avatar's. */
  mark: number;
}

export function mentionPillLook(
  pill: { kind: 'agent'; color: string } | { kind: 'machine' },
  { scheme, fontSize, live }: { scheme: 'light' | 'dark'; fontSize: number; live: string },
): MentionPillLook {
  const em = (n: number) => Math.round(n * fontSize * 100) / 100;
  const shared = { padRight: em(MENTION_PILL.padX), gap: em(MENTION_PILL.gap) };
  if (pill.kind === 'agent')
    return { ...shared, fill: pillTint(pill.color, MENTION_PILL.agentTint[scheme]), ink: 'fg', radius: MENTION_PILL.radius.agent, padLeft: em(MENTION_PILL.agentPadLeft), mark: MENTION_PILL.avatar };
  return { ...shared, fill: pillTint(live, MENTION_PILL.machineTint), ink: 'live', radius: MENTION_PILL.radius.machine, padLeft: em(MENTION_PILL.padX), mark: em(MENTION_PILL.icon) };
}
