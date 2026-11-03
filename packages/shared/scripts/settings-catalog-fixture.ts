// Writes packages/test-fixtures/settings-catalog.json from settings-catalog.ts: the sections, groups, search entries
// and old names, plus what a few searches find. packages/shared/tests/settings-catalog.test.ts fails until it is
// written again after a catalog change.
//   npx tsx packages/shared/scripts/settings-catalog-fixture.ts
import { writeFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { catalogFixture } from '../tests/settings-catalog-cases.ts';

writeFileSync(fixture('settings-catalog.json'), `${JSON.stringify(catalogFixture(), null, 2)}\n`);
console.log('wrote settings-catalog.json');
