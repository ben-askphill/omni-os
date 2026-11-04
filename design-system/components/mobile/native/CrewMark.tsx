import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

export type CrewRole = 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';

/** Crew marks, ring-derived silhouettes on the icon grid (components/icons/CrewMark.jsx). */
export function CrewMark({ role = 'conductor', size = 16, color }: { role?: CrewRole | string; size?: number; color: string }) {
  const s = { fill: 'none', stroke: color, strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let el;
  switch (role) {
    case 'researcher':
      el = <G><Circle cx={12} cy={12} r={8.5} {...s} /><Circle cx={12} cy={12} r={3.2} fill={color} /></G>;
      break;
    case 'builder':
      el = <G><Rect x={4} y={4} width={16} height={16} rx={3.5} {...s} /><Rect x={12} y={12} width={8} height={8} rx={2} fill={color} /></G>;
      break;
    case 'store-ops':
      el = <G><Path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5l8 8-9 9z" {...s} /><Circle cx={8.5} cy={8.5} r={1.75} fill={color} /></G>;
      break;
    case 'inbox':
      el = <Path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" {...s} />;
      break;
    default:
      el = <Circle cx={12} cy={12} r={7} fill="none" stroke={color} strokeWidth={3.6} />;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24">{el}</Svg>;
}
