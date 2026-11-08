/// <reference types="node" />
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Icon } from '../src/ui/Icon';
import { HarnessLogo, CrewMark, LinkBrand } from '../src/ui/Brand';
import { HARNESS, CREW } from '@omni/shared/brand.ts';
import { LINK_ICONS } from '@omni/shared/link-icons.ts';

vi.mock('../src/theme', () => ({ useOmniTheme: () => ({ colors: { fg: '#123456' } }) }));
vi.mock('../src/ui/Text', () => ({ Text: 'Text' }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Circle: 'Circle', Rect: 'Rect' }));
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

// Exercise the component, rather than just the registry: every accepted name
// must actually produce a path at the requested colour and size.
describe('native render paths', () => {
  it('renders every drawing and alias through SVG', () => {
    for (const name of [...Object.keys(ICON_PATHS), 'grok', ...Object.keys(ICON_ALIASES)]) {
      if (!isIconName(name)) throw new Error(name);
      const svg = Icon({ name, color: '#abcdef', size: 27 });
      expect(svg.type).toBe('Svg');
      expect(svg.props.width).toBe(27);
      expect(svg.props.children.props.d, name).toBeTruthy();
      expect(svg.props.stroke ?? svg.props.children.props.fill).toBe('#abcdef');
    }
  });

  it('renders all registered vendor, crew and link-brand marks', () => {
    for (const [harness, info] of Object.entries(HARNESS)) {
      if (!info.logo) continue; // Web uses initials for vendors without a drawing too.
      const svg = HarnessLogo({ harness });
      expect(svg.type).toBe('Svg');
      expect(svg.props.children.props.d, harness).toBeTruthy();
    }
    for (const role of Object.keys(CREW) as (keyof typeof CREW)[]) {
      expect(CrewMark({ role }).props.children.length, role).toBeGreaterThan(0);
    }
    for (const brand of Object.keys(LINK_ICONS)) {
      expect(LinkBrand({ brand }).props.children.every((p: { props: { d: string } }) => !!p.props.d), brand).toBe(true);
    }
  });

  it('keeps app-owned icons off SF Symbols and Unicode stand-ins', () => {
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    function check(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) check(path);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(path, 'utf8');
          expect(source, path).not.toMatch(/(?:from\s*|import\s*\()['"]expo-symbols['"]|sfSymbol:|systemImage:/);
          expect(source, path).not.toMatch(/[✓⚠◷▾▸]/);
        }
      }
    }
    check(root);
  });
});
