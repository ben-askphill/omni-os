import { defineConfig } from 'vitest/config';
import suite from '../../vitest.config.ts';

// For runner-teardown.test.ts: the suite's own config, setup included, pointed at the fixture files here.
export default defineConfig({ ...suite, test: { ...suite.test, include: ['tests/fixtures/teardown/*.fixture.ts'] } });
