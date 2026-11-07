import { describe, it, expect } from 'vitest';
import { ICON_PATHS, type IconName as SharedIconName } from '@omni/shared/icons.ts';
import { ICON_ALIASES, drawingName, isIconName, type IconName } from '../src/ui/symbols';

// A new web name is accepted by native without a separately maintained mapping.
type MissingNativeIcon = Exclude<SharedIconName, IconName>;
const complete: Record<MissingNativeIcon, never> = {};

describe('shared native drawings', () => {
  it('accepts every web drawing and resolves old names without a system fallback', () => {
    expect(complete).toEqual({});
    for (const name of [...Object.keys(ICON_PATHS), 'grok', ...Object.keys(ICON_ALIASES)]) {
      expect(isIconName(name), name).toBe(true);
      if (isIconName(name)) {
        const resolved = drawingName(name);
        expect(resolved === 'grok' || !!ICON_PATHS[resolved], name).toBe(true);
      }
    }
    expect(isIconName('toString')).toBe(false);
    expect(isIconName('not-an-icon')).toBe(false);
    expect(drawingName('close')).toBe('x');
    expect(drawingName('attach')).toBe('paperclip');
  });
});
