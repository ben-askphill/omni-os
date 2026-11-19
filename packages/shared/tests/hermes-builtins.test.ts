import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The iOS app runs this package on Hermes V1 (react-native/sdks/.hermesv1version). Its Array has toReversed and findLast,
// and its Promise has withResolvers, but it has no Array.prototype.toSorted: the version React Native 0.88 ships skips
// every test262 toSorted test (utils/testsuite/skiplist.json). TypeScript cannot catch it, since the iOS tsconfig takes
// ESNext's lib. Copy and sort here instead: [...list].sort(...).

const MISSING = [/\.toSorted\(/];

describe('packages/shared runs on Hermes', () => {
  it('uses no built-in Hermes lacks', () => {
    const dir = new URL('../', import.meta.url);
    const hits = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .flatMap((f) =>
        readFileSync(new URL(f, dir), 'utf8')
          .split('\n')
          .flatMap((line, i) => (MISSING.some((re) => re.test(line)) ? [`${f}:${i + 1}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});
