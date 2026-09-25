import { useEffect, useState } from 'react';
import { readPref, writePref } from '../store.tsx';
import { Segmented } from './ui.tsx';

export type ThemePref = 'system' | 'light' | 'dark';

const CHROME = { light: '#f7f7f6', dark: '#0c0d0f' };

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
const listeners = new Set<(t: ThemePref) => void>();

export function setTheme(t: ThemePref) {
  current = t;
  writePref('theme', t);
  apply(t);
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

export function ThemeSwitch({ className = '' }: { className?: string }) {
  const [t, set] = useTheme();
  return (
    <Segmented
      radio
      size="sm"
      label="Theme"
      value={t}
      onChange={set}
      className={className}
      options={[
        { id: 'light', icon: 'sun', title: 'Light' },
        { id: 'system', icon: 'monitor', title: 'Match system' },
        { id: 'dark', icon: 'moon', title: 'Dark' },
      ]}
    />
  );
}
