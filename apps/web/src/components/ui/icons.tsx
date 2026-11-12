import { OmniWordmark } from '../brand.tsx';

// ---------- icons (hand-drawn, 24px grid, 1.75 stroke, round caps and joins) ----------

import { ICON_PATHS as PATHS, GROK_BOT_PATH, type IconName } from '@omni/shared/icons.ts';
export type { IconName } from '@omni/shared/icons.ts';

export function Icon({ name, size = 16, className = '', strokeWidth = 1.75 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  if (name === 'grok') {
    return (
      <svg width={size} height={size} viewBox="25 25 168 168" fill="currentColor" className={`shrink-0 ${className}`} aria-hidden="true">
        <path d={GROK_BOT_PATH} fillRule="evenodd" />
      </svg>
    );
  }
  if (name === 'more') strokeWidth = 3;
  // A name cast from a string (settings catalog, PR groups) can miss the table and would draw nothing.
  if (import.meta.env.DEV && !PATHS[name]) console.error(`Icon: no icon named "${name}"`);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The continuous-line "omni" wordmark. */
export function Wordmark({ size = 18 }: { size?: number }) {
  return <OmniWordmark height={size} />;
}
