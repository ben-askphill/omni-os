import { Platform, useColorScheme } from 'react-native';

const light = {
  bg: '#ffffff',
  surface: '#f7f7f6',
  surface2: '#f1f1f0',
  surface3: '#ecebe7',
  fg: '#17181a',
  fg2: '#3c3b37',
  fg3: '#6f6e68',
  fg4: '#9d9c96',
  onInk: '#ffffff',
  line: 'rgba(23, 24, 26, 0.08)',
  lineStrong: 'rgba(23, 24, 26, 0.16)',
  live: '#2b3bff',
  needs: '#ff4420',
  done: '#c6f52b',
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
  fg3: '#908f89',
  fg4: '#6f6e69',
  onInk: '#101114',
  line: 'rgba(236, 235, 231, 0.08)',
  lineStrong: 'rgba(236, 235, 231, 0.16)',
  live: '#7280ff',
  needs: '#ff4420',
  done: '#c6f52b',
  ink: '#17181a',
  mark: 'rgba(245, 181, 68, 0.28)',
  diffAdd: 'rgba(198, 245, 43, 0.22)',
  diffDel: 'rgba(255, 68, 32, 0.12)',
};

export const space = {
  s2: 4,
  s4: 8,
  s6: 12,
  s8: 16,
  s9: 20,
  s10: 24,
  s11: 32,
  s12: 40,
} as const;

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

export const radius = {
  md: 14,
  xl: 20,
  pill: 999,
} as const;

export const fontSize = {
  meta: 11,
  body: 14,
  input: 16,
  heading: 17,
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

/** Apple's minimum touch target. */
export const minTarget = 44;

export type Scheme = 'light' | 'dark';

export function useOmniTheme(): { scheme: Scheme; colors: ColorTokens } {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: scheme === 'dark' ? dark : light };
}
