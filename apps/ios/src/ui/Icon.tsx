import { ICON_PATHS, GROK_BOT_PATH } from '@omni/shared/icons.ts';
import Svg, { Path } from 'react-native-svg';

import { useOmniTheme } from '../theme';
import { drawingName, type IconName } from './symbols';

export { isIconName, type IconName } from './symbols';

/** The web drawings, rendered as native paths without parsing SVG markup in lists. */
export function Icon({ name, size = 18, color, strokeWidth = 1.75 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const { colors } = useOmniTheme();
  const drawing = drawingName(name);
  const ink = color ?? colors.fg;
  if (drawing === 'grok') return <Svg width={size} height={size} viewBox="25 25 168 168" accessible={false}><Path d={GROK_BOT_PATH} fill={ink} fillRule="evenodd" /></Svg>;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth={drawing === 'more' ? 3 : strokeWidth} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Path d={ICON_PATHS[drawing]} />
    </Svg>
  );
}
