import { ICON_PATHS, type IconName as SharedIconName } from '@omni/shared/icons.ts';

/** Old iOS names still used by screens. Every alias must resolve to a shared drawing. */
export const ICON_ALIASES = {
  attach: 'paperclip', automation: 'zap', close: 'x', devices: 'monitor',
  doc: 'file', done: 'check', ellipsis: 'more', fork: 'branch',
  library: 'layers', machine: 'monitor', server: 'layers', settings: 'sliders',
  signOut: 'external', sparkle: 'zap', wifiOff: 'alert',
} as const satisfies Record<string, SharedIconName>;

export type IconName = SharedIconName | keyof typeof ICON_ALIASES;
export const isIconName = (name: string): name is IconName => name === 'grok' || Object.hasOwn(ICON_PATHS, name) || Object.hasOwn(ICON_ALIASES, name);
export const drawingName = (name: IconName): SharedIconName => Object.hasOwn(ICON_ALIASES, name) ? ICON_ALIASES[name as keyof typeof ICON_ALIASES] : name as SharedIconName;
