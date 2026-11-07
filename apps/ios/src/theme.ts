import { Platform, useColorScheme } from 'react-native';

const light = {
  bg: '#ffffff',
  surface: '#f7f7f6',
  surface2: '#f1f1f0',
  surface3: '#ecebe7',
  fg: '#17181a',
  fg2: '#3c3b37',
  fg3: '#62615c',
  fg4: '#9d9c96',
  onInk: '#ffffff',
  line: 'rgba(23, 24, 26, 0.08)',
  lineStrong: 'rgba(23, 24, 26, 0.16)',
  elev: '#ffffff',
  /** A segmented control's selected thumb (web: --thumb). */
  thumb: '#ffffff',
  wash: 'rgba(23, 24, 26, 0.06)',
  scrim: 'rgba(23, 24, 26, 0.22)',
  // Status is the only colour (web: --live, --needs, --done in apps/web/src/index.css). Full saturation, never tinted.
  // Needs and done fills carry ink text, and vermilion is never text on white.
  live: '#2b3bff',
  onLive: '#ffffff',
  needs: '#ff4420',
  onNeeds: '#17181a',
  done: '#c6f52b',
  onDone: '#17181a',
  /** The ring that keeps a lime dot visible on white. */
  doneEdge: '#17181a',
  ink: '#17181a',
  mark: 'rgba(245, 158, 11, 0.28)',
  diffAdd: 'rgba(198, 245, 43, 0.22)',
  diffDel: 'rgba(255, 68, 32, 0.12)',
} as const;

export type ColorTokens = { [K in keyof typeof light]: string };

const dark: ColorTokens = {
  bg: '#121316',
  surface: '#191b1e',
  surface2: '#222428',
  surface3: '#2a2c31',
  fg: '#eceae5',
  fg2: '#b8b7b1',
  fg3: '#a09f99',
  fg4: '#83827c',
  onInk: '#101114',
  line: 'rgba(236, 235, 231, 0.08)',
  lineStrong: 'rgba(236, 235, 231, 0.16)',
  elev: '#212429',
  thumb: 'rgba(255, 255, 255, 0.14)',
  wash: 'rgba(236, 234, 229, 0.06)',
  scrim: 'rgba(0, 0, 0, 0.5)',
  live: '#7280ff',
  onLive: '#101114',
  needs: '#ff4420',
  onNeeds: '#17181a',
  done: '#c6f52b',
  onDone: '#17181a',
  doneEdge: 'transparent',
  ink: '#17181a',
  mark: 'rgba(245, 181, 68, 0.28)',
  diffAdd: 'rgba(198, 245, 43, 0.22)',
  diffDel: 'rgba(255, 68, 32, 0.12)',
};

export const space = {
  s1: 2,
  s2: 4,
  s3: 6,
  s4: 8,
  s5: 10,
  s6: 12,
  s7: 14,
  s8: 16,
  s9: 20,
  s10: 24,
  s11: 32,
  s12: 40,
} as const;

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });
/** SF Pro Rounded, for monograms (web: --font-rounded). */
export const rounded = Platform.select({ ios: 'ui-rounded', default: undefined });

/** Radii from the Claude Design system (tokens/space.css; web: --r-*). */
export const radius = {
  xs: 6,
  sm: 12,
  md: 14,
  lg: 18,
  xl: 20,
  xxl: 22,
  xxxl: 28,
  pill: 999,
} as const;

/** Type sizes from the Claude Design system (tokens/type.css; web: --fs-*). */
export const fontSize = {
  label: 10.5,
  meta: 11,
  code: 11.5,
  caption: 12,
  small: 12.5,
  ui: 13,
  body: 14,
  prose: 14.5,
  subhead: 15,
  input: 16,
  heading: 17,
  title: 26,
  titleLg: 30,
} as const;

/** Weight scale, one step above the platform defaults so text reads less thin (web: --fw-* in apps/web/src/index.css). */
export const weight = {
  regular: '500',
  medium: '600',
  semibold: '700',
  bold: '800',
} as const;

export const lineHeight = {
  tight: 1.1,
  heading: 1.25,
  body: 1.45,
} as const;

/** Springs for state changes, from the web's --ease-spring and --ease-out (Bencho motion). */
export const motion = {
  spring: { damping: 16, stiffness: 260, mass: 0.8 },
  settle: { damping: 22, stiffness: 300, mass: 0.9 },
  /** How long the running dot's ping takes (web: --dur-ping). */
  ping: 1600,
} as const;

/** Apple's minimum touch target. */
export const minTarget = 44;

/**
 * The drawn height of a pill control that sits in a row of them: the model, machine and link chips. It is shorter than
 * the touch target to keep the row light, so every chip also takes `chipSlop` as its hitSlop to reach 44pt.
 */
export const chipHeight = 36;
export const chipSlop = (minTarget - chipHeight) / 2;

export type Scheme = 'light' | 'dark';

export function useOmniTheme(): { scheme: Scheme; colors: ColorTokens } {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: scheme === 'dark' ? dark : light };
}
