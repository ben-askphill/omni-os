import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_AGENTS } from '@omni/shared/crew-role.ts';
import { startRunner } from './runner-boot.ts';

// The built-in agents are listed once in code (packages/shared/crew-role.ts), for the name a thread shows before the
// agent list loads and the shape an agent takes. The charters in crew/ name them too, so the two must not drift: the
// inbox agent once showed as "Inbox" in the clients and "Admin" in its charter.

await startRunner();
const { splitCrewFile } = await import('../crew.ts');
const crewDir = join(import.meta.dirname, '../../../crew');
const shipped = readdirSync(crewDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));

describe('the built-in agents', () => {
  it('list every agent crew/ ships, by the name its charter gives it', () => {
    for (const id of shipped) {
      const { meta } = splitCrewFile(readFileSync(join(crewDir, `${id}.md`), 'utf8'));
      expect({ id, name: BUILT_IN_AGENTS[id]?.name }).toEqual({ id, name: meta.name });
    }
  });

  it('add only Store ops and Hermes, which ship no crew file', () => {
    expect(Object.keys(BUILT_IN_AGENTS).filter((id) => !shipped.includes(id)).sort()).toEqual(['hermes', 'store-ops']);
  });
});
