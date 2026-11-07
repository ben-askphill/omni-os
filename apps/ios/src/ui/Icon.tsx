import { SymbolView, type SymbolWeight } from 'expo-symbols';

import { useOmniTheme } from '../theme';
import { SYMBOLS, type IconName } from './symbols';

export type { IconName };

export function Icon({ name, size = 18, color, weight = 'medium' }: { name: IconName; size?: number; color?: string; weight?: SymbolWeight }) {
  const { colors } = useOmniTheme();
  return <SymbolView name={SYMBOLS[name]} size={size} tintColor={color ?? colors.fg} weight={weight} resizeMode="scaleAspectFit" style={{ width: size, height: size }} />;
}
