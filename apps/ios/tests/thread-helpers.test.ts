import { describe, expect, it } from 'vitest';

import { callDetail } from '../src/thread/call-detail';
import { duration, harnessLabel, plural } from '../src/thread/format';
import { linkTarget, linkThreads } from '../src/thread/links';

const ID = '3f9a1c2e-7b64-4d0f-9a31-2c5d8e4b7a10';

describe('linkThreads', () => {
  it('links a bare thread id', () => {
    expect(linkThreads(`See ${ID} for more`)).toBe(`See [${ID}](omni-thread:${ID}) for more`);
  });

  it('leaves ids in code, links, paths and queries alone', () => {
    for (const s of [`\`${ID}\``, `\`\`\`\n${ID}\n\`\`\``, `[${ID}](https://x.test)`, `[go](https://x.test/${ID})`, `https://x.test/?t=${ID}`, `/data/${ID}/file`, `[the thread ${ID}](https://x.test)`]) {
      expect(linkThreads(s)).toBe(s);
    }
  });

  it('links an id beside code', () => {
    expect(linkThreads(`\`x\` then ${ID}`)).toBe(`\`x\` then [${ID}](omni-thread:${ID})`);
  });
});

describe('linkTarget', () => {
  it('opens a thread in the app, a web address in the system, and ignores the rest', () => {
    expect(linkTarget(`omni-thread:${ID}`)).toEqual({ kind: 'thread', id: ID });
    expect(linkTarget('https://example.com/a')).toEqual({ kind: 'external', url: 'https://example.com/a' });
    expect(linkTarget('mailto:ben@example.com')).toEqual({ kind: 'external', url: 'mailto:ben@example.com' });
    expect(linkTarget('javascript:alert(1)')).toEqual({ kind: 'ignore' });
    expect(linkTarget('file:///etc/passwd')).toEqual({ kind: 'ignore' });
  });
});

describe('callDetail', () => {
  it('shows a command as it ran', () => {
    expect(callDetail({ name: 'Bash', input: { command: 'npm test\nnpm run lint' } })).toEqual([{ text: 'npm test' }, { text: 'npm run lint' }]);
  });

  it('shows an edit as removed then added lines', () => {
    expect(callDetail({ name: 'Edit', input: { old_string: 'a', new_string: 'b\nc' } })).toEqual([
      { text: 'a', tone: 'del' },
      { text: 'b', tone: 'add' },
      { text: 'c', tone: 'add' },
    ]);
  });

  it('cuts a long file write', () => {
    const out = callDetail({ name: 'Write', input: { content: Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n') } });
    expect(out).toHaveLength(15);
    expect(out[14].text).toBe('… 26 more lines');
  });

  it('leaves out an input the row summary already says', () => {
    expect(callDetail({ name: 'Read', input: { file_path: 'x.ts' } })).toEqual([]);
  });

  it('prints an unknown tool its input', () => {
    expect(callDetail({ name: 'mcp__x__y', input: { a: 1 } })[0].text).toBe('{');
  });
});

describe('format', () => {
  it('reads time and counts like phone web', () => {
    expect(duration(45_000)).toBe('45s');
    expect(duration(132_000)).toBe('2m 12s');
    expect(duration(3_900_000)).toBe('1h 5m');
    expect(duration(undefined)).toBe('');
    expect(plural(1, 'step')).toBe('1 step');
    expect(plural(3, 'step')).toBe('3 steps');
    expect(harnessLabel('codex')).toBe('Codex');
    expect(harnessLabel('other')).toBe('other');
  });
});
