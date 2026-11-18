import { describe, expect, it } from 'vitest';
import { pickerOptions } from '../src/components/composer/pickerOptions.tsx';

// The composer's Role picker (Settings > Crew, plan slice S3): roles wear their own avatar, a built-in without one its
// mark, and a role the Conductor may not delegate to is left out, as list_crew leaves it out. The Conductor stays,
// since the composer attaches it in #conductor.

const role = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, description: '', mcp: [], delegateOnly: false, delegatable: true, review: false, charter: '', kind: 'shipped' as const, hidden: false, ...over });

describe('the Role picker', () => {
  const crew = [
    role('conductor', { delegatable: false }),
    role('builder'),
    role('usage-scan', { delegatable: false }),
    role('store-ops', { kind: 'own', avatar: { icon: 'icon:zap', bg: '#f5e6ba' } }),
    role('notes', { kind: 'own' }),
  ];
  const { roleOptions } = pickerOptions([], 'inbox', crew);

  it('leaves out roles the Conductor may not delegate to, but keeps the Conductor', () => {
    expect(roleOptions.map((o) => o.value)).toEqual(['', 'conductor', 'builder', 'store-ops', 'notes']);
  });

  it("draws a role's own avatar, a built-in's mark, or its initials", () => {
    const of = (id: string) => roleOptions.find((o) => o.value === id)!;
    expect(of('store-ops')).toMatchObject({ channelIcon: 'icon:zap', avatarBg: '#f5e6ba', lead: undefined });
    expect(of('builder').lead).toBeTruthy();
    expect(of('notes')).toMatchObject({ avatar: 'notes', lead: undefined, channelIcon: undefined });
  });
});
