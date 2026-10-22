import { afterAll, vi } from 'vitest';
import { stopRunners } from './runner-boot.ts';

// Every /api request needs the token (apps/server/request-guard.ts). Tests call app.request as Omni's own clients
// would, so it carries OMNI_TOKEN (vitest.config.ts) unless the test sets its own Authorization header, or passes
// `authorization: ''` to send none. Done on Hono itself, since tests that boot two Macs import app.ts twice.
vi.mock('hono', async (importOriginal) => {
  const hono = await importOriginal<typeof import('hono')>();
  class Hono extends hono.Hono {
    constructor(...args: ConstructorParameters<typeof hono.Hono>) {
      super(...args);
      const request = this.request;
      this.request = (input, init, ...rest) => {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has('authorization')) headers.set('authorization', `Bearer ${process.env.OMNI_TOKEN}`);
        else if (!headers.get('authorization')) headers.delete('authorization');
        return request(input, { ...init, headers }, ...rest);
      };
    }
  }
  return { ...hono, Hono };
});

// Stops the runner a test file booted, once its tests are done. Registered here, not in startRunner:
// vitest only calls the afterAll hooks registered while it collects a file, and most files boot the
// runner in beforeAll, which runs after that.
afterAll(stopRunners, 15_000);
