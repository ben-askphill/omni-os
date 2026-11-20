import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { BlockSplitter, describeFile, feedText, parseArgs, releaseNames } from '../scripts/mac-release-package.ts';
import { scriptProblem } from '../scripts/release-policy.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);
/** The updater's own planner: what it downloads (kind 1) and what it copies from the installed version's zip (kind 0). */
const { computeOperations } = require('electron-updater/out/differentialDownloader/downloadPlanBuilder') as {
  computeOperations: (oldMap: unknown, newMap: unknown, logger: unknown) => { kind: number; start: number; end: number }[];
};

const scratch = mkdtempSync(join(tmpdir(), 'omni-mac-package-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function split(data: Uint8Array, pieces = [data.length]): BlockSplitter {
  const splitter = new BlockSplitter();
  let at = 0;
  for (const size of pieces) {
    splitter.push(data.subarray(at, at + size));
    at += size;
  }
  if (at < data.length) splitter.push(data.subarray(at));
  splitter.end();
  return splitter;
}

describe('the Mac release packaging script', () => {
  it('may run in the job that holds the signing secrets: it imports only Node built-ins', () => {
    expect(scriptProblem(REPO, 'apps/desktop/scripts/mac-release-package.ts')).toBeNull();
  });

  it('names the files as electron-builder did', () => {
    expect(releaseNames('0.1.43', 'universal').all).toEqual([
      'Omni-0.1.43-mac-universal.dmg',
      'Omni-0.1.43-mac-universal.dmg.blockmap',
      'Omni-0.1.43-mac-universal.zip',
      'Omni-0.1.43-mac-universal.zip.blockmap',
      'latest-mac.yml',
    ]);
  });

  it('reads its arguments and refuses what it cannot pack', () => {
    expect(parseArgs(['--version', '0.2.0', '--out', '/tmp/out', '/tmp/Omni.app'])).toEqual({ app: '/tmp/Omni.app', version: '0.2.0', arch: 'universal', out: '/tmp/out' });
    expect(parseArgs(['--version', '0.2.0', '--out', '/tmp/out', '--arch', 'arm64', '/tmp/Omni.app'])).toMatchObject({ arch: 'arm64' });
    expect(parseArgs(['--out', '/tmp/out', '/tmp/Omni.app'])).toEqual({ error: '--version needs a version such as 0.2.0' });
    expect(parseArgs(['--version', '0.2.0; rm -rf /', '--out', '/tmp/out', '/tmp/Omni.app'])).toHaveProperty('error');
    expect(parseArgs(['--version', '0.2.0', '/tmp/Omni.app'])).toEqual({ error: '--out needs the folder the release files go to' });
    expect(parseArgs(['--version', '0.2.0', '--out', '/tmp/out'])).toEqual({ error: 'name one app to pack' });
    expect(parseArgs(['--version', '0.2.0', '--out', '/tmp/out', '--sign', '/tmp/Omni.app'])).toEqual({ error: 'unknown option --sign' });
  });
});

describe('feedText', () => {
  const zip = { name: 'Omni-0.1.43-mac-universal.zip', sha512: 'emlw', size: 239095136 };
  const dmg = { name: 'Omni-0.1.43-mac-universal.dmg', sha512: 'ZG1n', size: 246779465 };
  const text = feedText('0.1.43', zip, dmg, new Date('2026-11-20T10:45:11.022Z'));

  it('writes latest-mac.yml line for line as electron-builder did', () => {
    expect(text).toBe(
      [
        'version: 0.1.43',
        'files:',
        '  - url: Omni-0.1.43-mac-universal.zip',
        '    sha512: emlw',
        '    size: 239095136',
        '  - url: Omni-0.1.43-mac-universal.dmg',
        '    sha512: ZG1n',
        '    size: 246779465',
        'path: Omni-0.1.43-mac-universal.zip',
        'sha512: emlw',
        "releaseDate: '2026-11-20T10:45:11.022Z'",
        '',
      ].join('\n'),
    );
  });

  it('parses to what the updater reads, with the zip first for Squirrel.Mac', () => {
    expect(parse(text)).toEqual({
      version: '0.1.43',
      files: [
        { url: zip.name, sha512: 'emlw', size: zip.size },
        { url: dmg.name, sha512: 'ZG1n', size: dmg.size },
      ],
      path: zip.name,
      sha512: 'emlw',
      releaseDate: '2026-11-20T10:45:11.022Z',
    });
  });
});

describe('the block map', () => {
  const data = randomBytes(3 * 1024 * 1024);

  it('covers every byte in blocks of 8 to 32 KB', () => {
    const { sizes, checksums } = split(data);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(data.length);
    expect(checksums).toHaveLength(sizes.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(32 * 1024);
    expect(Math.min(...sizes.slice(0, -1))).toBeGreaterThanOrEqual(8 * 1024);
    expect(checksums.every((checksum) => /^[A-Za-z0-9+/]{24}$/.test(checksum))).toBe(true);
    expect(checksums[0]).toBe(createHash('sha256').update(data.subarray(0, sizes[0])).digest().subarray(0, 18).toString('base64'));
  });

  it('is the same however the file is read', () => {
    const whole = split(data);
    const pieces = split(data, [1, 4095, 70_000, 1_000_000, 7]);
    expect(pieces.sizes).toEqual(whole.sizes);
    expect(pieces.checksums).toEqual(whole.checksums);
  });

  it('lets the updater copy what only moved and download what changed', () => {
    const inserted = randomBytes(5000);
    const next = Buffer.concat([data.subarray(0, 1_000_000), inserted, data.subarray(1_000_000)]);
    const map = (splitter: BlockSplitter) => ({ version: '2', files: [{ name: 'file', offset: 0, checksums: splitter.checksums, sizes: splitter.sizes }] });
    const operations = computeOperations(map(split(data)), map(split(next)), { info() {}, warn() {}, debug() {} });
    const downloaded = operations.filter((operation) => operation.kind === 1).reduce((sum, operation) => sum + operation.end - operation.start, 0);
    expect(downloaded).toBeGreaterThanOrEqual(inserted.length);
    expect(downloaded).toBeLessThan(100 * 1024);
  });

  it('describes a file with its sha512 and size as the feed spells them', () => {
    const path = join(scratch, 'file.zip');
    writeFileSync(path, data);
    const described = describeFile(path);
    expect(described.size).toBe(data.length);
    expect(described.sha512).toBe(createHash('sha512').update(data).digest('base64'));
    expect(described.blockMap).toEqual({ version: '2', files: [{ name: 'file', offset: 0, ...(({ checksums, sizes }) => ({ checksums, sizes }))(split(data)) }] });
  });
});
