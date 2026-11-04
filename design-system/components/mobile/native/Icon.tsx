import Svg, { Path } from 'react-native-svg';

import { ICON_ALIAS, ICON_PATHS, type IconName } from './icon-paths';

/** The Omni icon set on the 24 grid: 1.75 stroke, round caps and joins, drawn in `color`. */
export function Icon({ name, size = 16, color, strokeWidth = 1.75 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  const key = (ICON_ALIAS as Record<string, keyof typeof ICON_PATHS>)[name] ?? (name as keyof typeof ICON_PATHS);
  const d = ICON_PATHS[key];
  if (!d) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={key === 'more' ? 3 : strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}
