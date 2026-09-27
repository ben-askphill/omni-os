import { beforeAll, it, vi } from 'vitest';
import { startRunner } from '../../runner-boot.ts';
import { report } from './report.ts';

// Run by runner-teardown.test.ts in a vitest of its own. Its shutdownAll never finishes, like a runner
// stuck waiting on a process, and its Claude CLI has left a child behind that holds the CLI's stdout
// (ORPHAN). The teardown must still stop both and remove the tmp dir.
vi.mock(import('../../../server/runner.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  shutdownAll: () => new Promise<void>(() => {}),
}));

let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  H = await startRunner();
});

it('ends with a Claude process and the child it left behind still running', async () => {
  const t = await H.start('ORPHAN', { title: 'Orphan' });
  await H.untilResults(t.id, 1);
  await H.until('the orphan', () => H.invocations().some((i) => i.mode === 'orphan'));
  report(H);
});
