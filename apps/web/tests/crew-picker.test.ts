import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { pickerOptions } from '../src/components/composer/pickerOptions.tsx';

// The composer's Agent picker (Settings > Crew, plan slice S3, and group threads slice 1): agents wear their avatar
// (AgentAvatar): an uploaded image, their icon, else their crew character (ADR 0021). A role the Conductor may not
// delegate to is left out, as list_crew leaves it out. The Conductor stays, since the composer attaches it in #conductor.

const role = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, description: '', mcp: [], delegateOnly: false, delegatable: true, review: false, charter: '', kind: 'shipped' as const, hidden: false, ...over });

describe('the Role picker', () => {
  const crew = [
    role('conductor', { delegatable: false }),
    role('builder'),
    role('usage-scan', { delegatable: false }),
    role('store-ops', { kind: 'own', avatar: { icon: 'icon:zap', bg: '#f5e6ba' } }),
    role('notes', { kind: 'own' }),
    role('designer', { kind: 'own', name: 'Designer', avatar: { image: '/api/crew/designer/avatar?v=abc' } }),
  ];
  const { roleOptions } = pickerOptions([], 'inbox', crew);

  it('leaves out roles the Conductor may not delegate to, but keeps the Conductor', () => {
    expect(roleOptions.map((o) => o.value)).toEqual(['', 'conductor', 'builder', 'store-ops', 'notes', 'designer']);
  });

  it("draws an agent's uploaded image, its icon, or its crew character with idle eyes", () => {
    const face = (id: string) => renderToStaticMarkup(roleOptions.find((o) => o.value === id)!.face!(28));
    expect(face('designer')).toContain('src="/api/crew/designer/avatar?v=abc"');
    expect(face('store-ops')).toContain('background-color:#f5e6ba');
    expect(face('builder')).toMatch(/<svg[^>]*data-shape="squircle"[^>]*data-grid="24"[^>]*data-eyes="idle"/);
    expect(face('notes')).toMatch(/<svg[^>]*data-grid="24"[^>]*data-eyes="idle"/);
    expect(face('notes')).not.toContain('data-initials');
  });
});
