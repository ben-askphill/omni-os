import { beforeAll, it } from 'vitest';
import { startRunner } from '../../runner-boot.ts';
import { FAKE_CURSOR } from '../../support.ts';
import { report } from './report.ts';

// Run by runner-teardown.test.ts in a vitest of its own. Boots the runner in beforeAll, as most runner
// test files do, and ends with a Cursor turn still running, like delegate.test.ts.

let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  H = await startRunner({ OMNI_CURSOR_BIN: FAKE_CURSOR });
  await (await import('../../../server/harness/catalog-service.ts')).loadCatalog(['cursor']);
});

it('ends with a Cursor turn still running', async () => {
  const t = await H.start('HANG forever', { harness: 'cursor', model: 'gpt-5.6-sol', effort: 'high' });
  await H.until('turn running', () => H.cursorRequests().some((r) => r.method === 'turn' && r.thread_id === t.id));
  report(H);
});
