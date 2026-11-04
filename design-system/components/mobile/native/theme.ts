/**
 * Omni OS tokens for Expo / React Native. Values come from project/tokens.json (colour, shadow), tokens/motion.css and the
 * `phone` token family; change them there first, then here. This file replaces apps/ios/src/theme.ts, which copied only
 * a subset (no elev, warn, wash, scrim, live-text, shadows or motion).
 */
import { useColorScheme, type TextStyle } from 'react-native';

const light = {
  canvas: '#ffffff',
  bg: '#ffffff',
  surface: '#f7f7f6',
  surface2: '#f1f1f0',
  surface3: '#ecebe7',
  elev: '#ffffff',
  fg: '#17181a',
  fg2: '#3c3b37',
  fg3: '#6f6e68',
  fg4: '#9d9c96',
  onInk: '#ffffff',
  line: 'rgba(23, 24, 26, 0.08)',
  lineStrong: 'rgba(23, 24, 26, 0.16)',
  wash: 'rgba(23, 24, 26, 0.06)',
  thumb: '#ffffff',
  scrim: 'rgba(23, 24, 26, 0.22)',
  bubble: '#f1f1f0',
  codeBg: '#f7f7f6',
  mark: 'rgba(245, 158, 11, 0.28)',
  warn: '#b45309',
  ink: '#17181a',
  /** Running. The pinging disc and running text (`live-text`). */
  live: '#2b3bff',
  onLive: '#ffffff',
  /** Needs you. The still diamond and the answer button. Never animates. */
  needs: '#ff4420',
  onNeeds: '#17181a',
  /** Done. The edged volt disc and done chips. */
  done: '#c6f52b',
  onDone: '#17181a',
  doneEdge: '#17181a',
  diffAdd: 'rgba(198, 245, 43, 0.22)',
  diffDel: 'rgba(255, 68, 32, 0.12)',
};

export type ColorTokens = { [K in keyof typeof light]: string };

const dark: ColorTokens = {
  canvas: '#0c0d0f',
  bg: '#121316',
  surface: '#191b1e',
  surface2: '#222428',
  surface3: '#2a2c31',
  elev: '#212429',
  fg: '#eceae5',
  fg2: '#b8b7b1',
  fg3: '#908f89',
  fg4: '#6f6e69',
  onInk: '#101114',
  line: 'rgba(236, 235, 231, 0.08)',
  lineStrong: 'rgba(236, 235, 231, 0.16)',
  wash: 'rgba(236, 234, 229, 0.06)',
  thumb: 'rgba(255, 255, 255, 0.14)',
  scrim: 'rgba(0, 0, 0, 0.5)',
  bubble: '#222428',
  codeBg: '#191b1e',
  mark: 'rgba(245, 181, 68, 0.28)',
  warn: '#f5b544',
  ink: '#17181a',
  live: '#7280ff',
  onLive: '#101114',
  needs: '#ff4420',
  onNeeds: '#17181a',
  done: '#c6f52b',
  onDone: '#17181a',
  doneEdge: 'transparent',
  diffAdd: 'rgba(198, 245, 43, 0.22)',
  diffDel: 'rgba(255, 68, 32, 0.12)',
};

/** Shadows as RN `boxShadow` strings (New Architecture). Same values as tokens.json `shadow` and tokens/space.css. */
export type ShadowTokens = { card: string; thumb: string; menu: string };

const shadows: Record<'light' | 'dark', ShadowTokens> = {
  light: {
    card: '0 0 0 0.5px rgba(23, 24, 26, 0.07), 0 1px 2px rgba(23, 24, 26, 0.05)',
    thumb: '0 1px 2px rgba(23, 24, 26, 0.09), 0 0 0 0.5px rgba(23, 24, 26, 0.05)',
    menu: '0 0 0 0.5px rgba(23, 24, 26, 0.08), 0 2px 4px rgba(23, 24, 26, 0.04), 0 18px 44px -10px rgba(23, 24, 26, 0.2)',
  },
  dark: {
    card: '0 0 0 0.5px rgba(255, 255, 255, 0.09), 0 1px 2px rgba(0, 0, 0, 0.4)',
    thumb: '0 1px 2px rgba(0, 0, 0, 0.3), 0 0 0 0.5px rgba(255, 255, 255, 0.06)',
    menu: '0 0 0 0.5px rgba(255, 255, 255, 0.08), 0 2px 4px rgba(0, 0, 0, 0.3), 0 18px 44px -10px rgba(0, 0, 0, 0.65)',
  },
};

/** Phone metrics in points (tokens.json `phone`). Safe-area insets come from react-native-safe-area-context at runtime. */
export const phone = {
  gutter: 16,
  headerH: 52,
  round: 40,
  roundSmall: 32,
  tabbarH: 60,
  tabbarInset: 14,
  tabbarLift: 6,
  rowMin: 52,
  avatar: 36,
  composerH: 52,
  chipH: 36,
  answerH: 48,
  cardRadius: 20,
  innerRadius: 14,
  sheetRadius: 28,
  composerRadius: 26,
  grabber: { width: 36, height: 5 },
  minTarget: 44,
} as const;

export const space = { s1: 2, s2: 4, s3: 6, s4: 8, s5: 10, s6: 12, s7: 14, s8: 16, s9: 20, s10: 24, s11: 32, s12: 40 } as const;

export const radius = { xs: 6, sm: 12, md: 14, lg: 18, xl: 20, xxl: 22, xxxl: 28, pill: 999 } as const;

/** iOS draws the system font (SF Pro) when fontFamily is unset. SF Mono is not exposed to apps; Menlo is its stand-in. */
export const mono = 'Menlo';

const t = (fontSize: number, lineHeight: number, fontWeight: TextStyle['fontWeight'] = '400', extra: TextStyle = {}): TextStyle => ({
  fontSize,
  lineHeight: Math.round(fontSize * lineHeight),
  fontWeight,
  ...extra,
});

/** The phone type scale. Sizes are the kit's; weights stay at 400 and 500 (600 only for rare emphasis). */
export const type = {
  largeTitle: t(30, 1.1, '500', { letterSpacing: -0.3 }),
  sheetTitle: t(17, 1.25, '500'),
  cardTitle: t(16, 1.3, '500'),
  navTitle: t(15, 1.25, '500'),
  row: t(15, 1.3),
  rowStrong: t(15, 1.3, '500'),
  bubble: t(15, 1.45),
  prose: t(15, 1.6),
  input: t(16, 1.3),
  answer: t(15, 1, '500'),
  option: t(14.5, 1.3, '500'),
  body: t(14, 1.5),
  chip: t(13.5, 1, '500'),
  toast: t(13.5, 1, '500'),
  value: t(13, 1, '400', { fontVariant: ['tabular-nums'] }),
  titleSub: t(13, 1.4, '400', { fontVariant: ['tabular-nums'] }),
  sub: t(12.5, 1.35),
  caption: t(12, 1.3, '500'),
  meta: t(12, 1.3, '400', { fontVariant: ['tabular-nums'] }),
  navSub: t(12, 1.35),
  tab: t(11, 1, '500'),
  code: t(13, 1.3, '400', { fontFamily: mono }),
} as const;

/**
 * Motion. Bezier control points for `Easing.bezier(...)` and spring configs for Reanimated 4 `withSpring` that land on
 * the same durations as the web's springs.
 */
export const motion = {
  bezier: {
    spring: [0.24, 1.34, 0.38, 1],
    settle: [0.28, 1.28, 0.36, 1],
    stretch: [0.32, 0.72, 0.24, 1],
    out: [0.22, 1, 0.36, 1],
  },
  duration: { hover: 160, stretch: 190, press: 220, enter: 240, wash: 320, settle: 420, sheet: 460, panel: 500, ping: 1600 },
  /** Tab thumb, toggles, toasts: a visible overshoot. */
  spring: { duration: 420, dampingRatio: 0.68 },
  /** Press release and small settles. */
  settle: { duration: 220, dampingRatio: 0.78 },
  /** Press: scale to this and back. */
  pressScale: 0.96,
} as const;

export type Scheme = 'light' | 'dark';

export type OmniTheme = {
  scheme: Scheme;
  colors: ColorTokens;
  shadow: ShadowTokens;
};

export function themeFor(scheme: Scheme): OmniTheme {
  return { scheme, colors: scheme === 'dark' ? dark : light, shadow: shadows[scheme] };
}

export function useOmniTheme(): OmniTheme {
  return themeFor(useColorScheme() === 'dark' ? 'dark' : 'light');
}
