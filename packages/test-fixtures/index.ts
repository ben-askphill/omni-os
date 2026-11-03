import { join } from 'node:path';

// Fixtures more than one package reads: the fake CLIs, recorded CLI output, the corpora the server,
// web and shared tests check against, and the server JSON apps/server/tests/wire-fixtures.test.ts records.
export const FIXTURES = import.meta.dirname;

export const fixture = (...parts: string[]) => join(FIXTURES, ...parts);

export const WIRE_FIXTURES = fixture('wire');
