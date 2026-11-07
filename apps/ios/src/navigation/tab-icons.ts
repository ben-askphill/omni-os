import type { ImageSourcePropType } from 'react-native';

// UIKit requires UIImage rather than SVG nodes. Generated from shared paths by build-tab-icons.ts.
const TAB_ICONS = {
  inbox: require('./tab-icons/inbox.png'),
  hash: require('./tab-icons/hash.png'),
  layers: require('./tab-icons/layers.png'),
  plus: require('./tab-icons/plus.png'),
} satisfies Record<string, ImageSourcePropType>;
export type TabIconName = keyof typeof TAB_ICONS;
export const tabIcon = (name: TabIconName) => ({ type: 'imageSource' as const, imageSource: TAB_ICONS[name], renderingMode: 'template' as const });
