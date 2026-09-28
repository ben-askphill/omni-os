// One of several processes racing for the same lock, for tests/lock.test.ts.
// Says "ready", waits for a line holding the moment to go at, spins until then, calls takeLock and
// prints what it returned. It holds whatever it got until its stdin closes.
import { createInterface } from 'node:readline';
import { takeLock } from '../../server/lock.ts';

const lines = createInterface({ input: process.stdin });
lines.once('line', (line) => {
  const at = Number(line);
  while (Date.now() < at);
  let holder;
  try {
    holder = takeLock(process.argv[2]);
  } catch (err) {
    holder = String(err);
  }
  process.stdout.write(`${JSON.stringify({ pid: process.pid, holder })}\n`);
});
lines.on('close', () => process.exit(0));
process.stdout.write('ready\n');
