import { join } from 'node:path';

// Fixtures more than one package reads: the fake CLIs, recorded CLI output and the corpora the
// Web UI and the Mac app's Swift tests both check against.
export const FIXTURES = import.meta.dirname;

export const fixture = (...parts: string[]) => join(FIXTURES, ...parts);
