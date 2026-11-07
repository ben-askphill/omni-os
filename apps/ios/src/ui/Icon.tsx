import { SymbolView, type SymbolViewProps, type SymbolWeight } from 'expo-symbols';

import { useOmniTheme } from '../theme';

type SFSymbol = Extract<SymbolViewProps['name'], string>;

/**
 * The app's icon set: SF Symbols under the names the Web UI's line icons use (`apps/web/src/components/ui/icons.tsx`),
 * so a screen reads the same on both. One weight and size per use keeps them consistent.
 */
const SYMBOLS = {
  alert: 'exclamationmark.triangle',
  archive: 'archivebox',
  arrowUp: 'arrow.up',
  attach: 'paperclip',
  automation: 'bolt',
  bell: 'bell',
  branch: 'arrow.triangle.branch',
  browser: 'safari',
  check: 'checkmark',
  chevronDown: 'chevron.down',
  chevronLeft: 'chevron.left',
  chevronRight: 'chevron.right',
  clock: 'clock',
  close: 'xmark',
  delegate: 'person.2',
  devices: 'iphone.gen3',
  diff: 'plusminus',
  doc: 'doc.text',
  done: 'checkmark.circle',
  ellipsis: 'ellipsis',
  file: 'doc',
  folder: 'folder',
  fork: 'arrow.branch',
  gauge: 'gauge.with.dots.needle.33percent',
  globe: 'globe',
  grid: 'square.grid.2x2',
  hash: 'number',
  home: 'house',
  image: 'photo',
  inbox: 'tray',
  info: 'info.circle',
  key: 'key',
  layers: 'square.3.layers.3d',
  library: 'books.vertical',
  lock: 'lock',
  machine: 'desktopcomputer',
  message: 'bubble.left',
  monitor: 'display',
  moon: 'moon',
  pencil: 'pencil',
  pin: 'pin',
  play: 'play.fill',
  plus: 'plus',
  pr: 'arrow.triangle.pull',
  refresh: 'arrow.clockwise',
  search: 'magnifyingglass',
  server: 'server.rack',
  settings: 'gearshape',
  share: 'square.and.arrow.up',
  signOut: 'rectangle.portrait.and.arrow.right',
  sliders: 'slider.horizontal.3',
  sparkle: 'sparkle',
  split: 'square.split.2x1',
  stop: 'stop.fill',
  sun: 'sun.max',
  switchboard: 'switch.2',
  target: 'scope',
  terminal: 'terminal',
  tool: 'wrench.and.screwdriver',
  trash: 'trash',
  undo: 'arrow.uturn.backward',
  wifiOff: 'wifi.slash',
  zap: 'bolt',
} as const satisfies Record<string, SFSymbol>;

export type IconName = keyof typeof SYMBOLS;

export const isIconName = (name: string): name is IconName => Object.hasOwn(SYMBOLS, name);

export function Icon({ name, size = 18, color, weight = 'medium' }: { name: IconName; size?: number; color?: string; weight?: SymbolWeight }) {
  const { colors } = useOmniTheme();
  return <SymbolView name={SYMBOLS[name]} size={size} tintColor={color ?? colors.fg} weight={weight} resizeMode="scaleAspectFit" style={{ width: size, height: size }} />;
}
