import { afterAll } from 'vitest';
import { stopRunners } from './runner-boot.ts';

// Stops the runner a test file booted, once its tests are done. Registered here, not in startRunner:
// vitest only calls the afterAll hooks registered while it collects a file, and most files boot the
// runner in beforeAll, which runs after that.
afterAll(stopRunners, 15_000);
