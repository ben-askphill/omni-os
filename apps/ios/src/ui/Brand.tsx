import { HARNESS, HARNESS_LOGOS } from '@omni/shared/brand.ts';
import { LINK_ICONS } from '@omni/shared/link-icons.ts';
import Svg, { Path } from 'react-native-svg';
import { useOmniTheme } from '../theme';
import { Text } from './Text';

export function HarnessLogo({ harness, size = 14 }: { harness: string; size?: number }) {
  const { colors } = useOmniTheme();
  const h = HARNESS[harness];
  if (!h?.logo) return <Text style={{ width: size, height: size, fontSize: Math.max(7, size * 0.62), lineHeight: size, textAlign: 'center' }}>{harness.slice(0, 2).toUpperCase()}</Text>;
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}><Path d={HARNESS_LOGOS[h.logo]} fill={colors.fg} /></Svg>;
}

export function LinkBrand({ brand, size = 16 }: { brand: string; size?: number }) {
  const { colors } = useOmniTheme();
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    {(LINK_ICONS[brand] ?? LINK_ICONS.link).map((p, i) => <Path key={i} d={p.d} fill={p.stroke ? 'none' : p.fill ?? colors.fg} stroke={p.stroke ? p.fill ?? colors.fg : undefined} strokeWidth={p.stroke} strokeLinecap="round" strokeLinejoin="round" />)}
  </Svg>;
}
