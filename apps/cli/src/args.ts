// A small option parser: `--name value`, `--name=value`, `-n value`, boolean flags, `--` and `-` (stdin).
import { UsageError } from './io.ts';

export interface FlagSpec {
  /** One letter, used as `-x`. */
  short?: string;
  /** Takes a value. Otherwise it is a switch. */
  value?: boolean;
}

export type FlagSpecs = Record<string, FlagSpec>;

export interface Parsed {
  positional: string[];
  /** A switch is `true`, a value flag its last value. */
  flags: Record<string, string | true>;
}

export function parseArgs(argv: readonly string[], specs: FlagSpecs, command: string): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const byShort = new Map(Object.entries(specs).flatMap(([name, s]) => (s.short ? [[s.short, name] as const] : [])));
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-' || !arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    const long = arg.startsWith('--');
    const eq = long ? arg.indexOf('=') : -1;
    const key = long ? arg.slice(2, eq < 0 ? undefined : eq) : arg.slice(1);
    const name = long ? key : byShort.get(key);
    const spec = name ? specs[name] : undefined;
    if (!name || !spec) throw new UsageError(`unknown option ${arg}`, command);
    if (!spec.value) {
      if (eq >= 0) throw new UsageError(`--${name} takes no value`, command);
      flags[name] = true;
      continue;
    }
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === '') throw new UsageError(`--${name} needs a value`, command);
    flags[name] = value;
  }
  return { positional, flags };
}

export const flag = (p: Parsed, name: string): boolean => p.flags[name] === true;

export function value(p: Parsed, name: string): string | undefined {
  const v = p.flags[name];
  return typeof v === 'string' ? v : undefined;
}
