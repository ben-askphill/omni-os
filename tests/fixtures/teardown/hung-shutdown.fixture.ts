import { beforeAll, it } from 'vitest';
import { startRunner } from '../../runner-boot.ts';
import { report } from './report.ts';

// Run by runner-teardown.test.ts in a vitest of its own. Its Claude CLI leaves a child behind that holds
// the CLI's stdout (ORPHAN), so the runner never sees that process close and shutdownAll never finishes.

let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  H = await startRunner();
});

it('ends with a Claude process whose stdout never closes', async () => {
  const t = await H.start('ORPHAN', { title: 'Orphan' });
  await H.untilResults(t.id, 1);
  await H.until('the orphan', () => H.invocations().some((i) => i.mode === 'orphan'));
  report(H);
});
