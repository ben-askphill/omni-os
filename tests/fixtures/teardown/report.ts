import { writeFileSync } from 'node:fs';
import type { startRunner } from '../../runner-boot.ts';

/** Write down what the file's teardown must clean up: its tmp dir and every fake process it started. */
export function report(H: Awaited<ReturnType<typeof startRunner>>) {
  const fakes = [
    ...H.invocations().map((i) => ({ pid: i.pid, fixture: 'fake-claude.mjs' })),
    ...H.codexRequests().map((r) => ({ pid: r.pid, fixture: 'fake-codex.mjs' })),
    ...H.cursorRequests().map((r) => ({ pid: r.pid, fixture: 'fake-cursor.mjs' })),
  ];
  writeFileSync(process.env.TEARDOWN_REPORT!, JSON.stringify({ tmp: H.tmp, fakes }));
}
