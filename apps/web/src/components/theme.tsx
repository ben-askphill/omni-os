import { useEffect, useMemo, useState } from 'react';
import { RENDER_COLORS, RENDER_OTHER, type FrameTheme } from '@omni/shared/html-render.ts';
import { desktop } from '../desktop.ts';
import { readPref, writePref } from '../store.tsx';

export type ThemePref = 'system' | 'light' | 'dark';

const CHROME = { light: '#ffffff', dark: '#0c0d0f' };

function apply(t: ThemePref) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  // Keep the browser chrome in step with a forced scheme.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const scheme = t === 'system' ? (m.media.includes('dark') ? 'dark' : 'light') : t;
    m.content = CHROME[scheme];
  });
}

const valid = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark';
let current: ThemePref = (() => {
  const v = readPref<unknown>('theme', 'system');
  return valid(v) ? v : 'system';
})();
// The desktop app draws its own window chrome and menus in the theme the page picked.
desktop?.setAppearance(current);
const listeners = new Set<(t: ThemePref) => void>();

export function setTheme(t: ThemePref) {
  current = t;
  writePref('theme', t);
  apply(t);
  desktop?.setAppearance(t);
  listeners.forEach((fn) => fn(t));
}

export function useTheme() {
  const [t, setT] = useState(current);
  useEffect(() => {
    listeners.add(setT);
    return () => {
      listeners.delete(setT);
    };
  }, []);
  return [t, setTheme] as const;
}

/** The scheme the app draws in: the forced one, or the system's. */
export function useScheme(): 'light' | 'dark' {
  const [pref] = useTheme();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(media.matches);
    media.addEventListener('change', on);
    return () => media.removeEventListener('change', on);
  }, []);
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

/**
 * Omni's theme as an html_render page gets it: each variable the page reads with its token's resolved value. A probe
 * resolves colours, since a custom property's own value is still the unresolved `light-dark(...)`.
 */
export function useFrameTheme(): FrameTheme {
  const scheme = useScheme();
  return useMemo(() => {
    const probe = document.createElement('i');
    probe.style.display = 'none';
    document.body.append(probe);
    const vars: Record<string, string> = {};
    for (const [name, token] of Object.entries(RENDER_COLORS)) {
      probe.style.color = `var(${token})`;
      vars[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    const root = getComputedStyle(document.documentElement);
    for (const [name, token] of Object.entries(RENDER_OTHER)) vars[name] = root.getPropertyValue(token).trim();
    return { scheme, vars };
  }, [scheme]);
}
