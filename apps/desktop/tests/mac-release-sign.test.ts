import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { codesignArgs, isMachO, parseSignArgs, signApp, signingOrder } from '../scripts/mac-release-sign.ts';

const require = createRequire(import.meta.url);
const { TIMESTAMP_RETRY_WAITS, OTHER_RETRY_WAITS } = require('../scripts/codesign-retry.cjs');

const MACHO_64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
const FAT = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x02]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const scratch = mkdtempSync(join(tmpdir(), 'omni-mac-sign-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** An app tree laid out like Omni's universal build: Mach-O files, resources, a framework with its symlinks, a helper. */
function fakeApp(): string {
  const app = join(mkdtempSync(join(scratch, 'build-')), 'Omni.app');
  const files: Record<string, Buffer | string> = {
    'Contents/Info.plist': '<plist/>',
    'Contents/MacOS/Omni': FAT,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework': FAT,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib': FAT,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler': FAT,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/icudtl.dat': PNG,
    'Contents/Frameworks/Omni Helper (GPU).app/Contents/MacOS/Omni Helper (GPU)': FAT,
    'Contents/Frameworks/Omni Helper (GPU).app/Contents/Info.plist': '<plist/>',
    'Contents/Resources/app.asar': PNG,
    'Contents/Resources/omni/bin/omni': FAT,
    'Contents/Resources/omni/node_modules/node-pty/prebuilds/darwin-arm64/pty.node': MACHO_64,
    'Contents/Resources/omni/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper': MACHO_64,
    'Contents/Resources/omni/node_modules/playwright-core/lib/codicon.ttf': PNG,
  };
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(dirname(join(app, path)), { recursive: true });
    writeFileSync(join(app, path), data);
  }
  const framework = join(app, 'Contents/Frameworks/Electron Framework.framework');
  symlinkSync('A', join(framework, 'Versions/Current'));
  symlinkSync('Versions/Current/Electron Framework', join(framework, 'Electron Framework'));
  symlinkSync('Versions/Current/Libraries', join(framework, 'Libraries'));
  return app;
}

const opts = (app: string) => ({ app, identity: 'ABCDEF0123', keychain: '/tmp/signing.keychain-db', entitlements: 'entitlements.mac.plist' });

describe('isMachO', () => {
  it('knows thin and universal Mach-O files from anything else', () => {
    expect(isMachO(MACHO_64)).toBe(true);
    expect(isMachO(FAT)).toBe(true);
    expect(isMachO(Buffer.from([0xce, 0xfa, 0xed, 0xfe]))).toBe(true);
    expect(isMachO(PNG)).toBe(false);
    expect(isMachO(Buffer.from('#!/bin/sh\n'))).toBe(false);
    expect(isMachO(Buffer.alloc(0))).toBe(false);
  });
});

describe('signingOrder', () => {
  it('lists every Mach-O file, .app and .framework once, inside before outside, and the app last', () => {
    const app = fakeApp();
    const order = signingOrder(app).map((path) => relative(app, path) || '.');
    expect([...order].sort()).toEqual(
      [
        '.',
        'Contents/Frameworks/Electron Framework.framework',
        'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
        'Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler',
        'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib',
        'Contents/Frameworks/Omni Helper (GPU).app',
        'Contents/Frameworks/Omni Helper (GPU).app/Contents/MacOS/Omni Helper (GPU)',
        'Contents/MacOS/Omni',
        'Contents/Resources/omni/bin/omni',
        'Contents/Resources/omni/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
        'Contents/Resources/omni/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      ].sort(),
    );
    expect(order.at(-1)).toBe('.');
    for (const [i, path] of order.entries()) {
      if (path === '.') continue;
      // Nothing signed after a bundle sits inside it, or the bundle's seal would go stale.
      for (const later of order.slice(i + 1)) expect(later.startsWith(`${path}/`)).toBe(false);
    }
  });
});

describe('codesignArgs', () => {
  it('signs as electron-builder did: forced, timestamped, hardened, with the entitlements', () => {
    expect(codesignArgs('/x/Omni.app', opts('/x/Omni.app'))).toEqual([
      '--sign',
      'ABCDEF0123',
      '--force',
      '--keychain',
      '/tmp/signing.keychain-db',
      '--timestamp',
      '--options',
      'runtime',
      '--entitlements',
      'entitlements.mac.plist',
      '/x/Omni.app',
    ]);
  });
});

/** A codesign that throws each queued error for the path it names, then succeeds. */
function fakeCodesign(failures: Record<string, Error[]> = {}) {
  const calls: string[][] = [];
  const waits: number[] = [];
  return {
    calls,
    waits,
    deps: {
      codesign: async (args: string[]) => {
        calls.push(args);
        const error = failures[args.at(-1) ?? '']?.shift();
        if (error) throw error;
      },
      wait: async (seconds: number) => void waits.push(seconds),
      log: () => {},
    },
  };
}

const timestampError = new Error('Command failed: codesign ...\n.../spawn-helper: A timestamp was expected but was not found.');

describe('signApp', () => {
  it('signs each path in order and verifies the app at the end', async () => {
    const app = fakeApp();
    const fake = fakeCodesign();
    const signed = await signApp(opts(app), fake.deps);
    expect(signed).toEqual(signingOrder(app));
    expect(fake.calls.slice(0, -1)).toEqual(signed.map((path) => codesignArgs(path, opts(app))));
    expect(fake.calls.at(-1)).toEqual(['--verify', '--deep', '--strict', '--verbose=2', app]);
  });

  it('waits out the timestamp server on the file it failed on, without starting over', async () => {
    const app = fakeApp();
    const helper = join(app, 'Contents/Resources/omni/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper');
    const fake = fakeCodesign({ [helper]: [timestampError, timestampError] });
    const signed = await signApp(opts(app), fake.deps);
    expect(fake.waits).toEqual(TIMESTAMP_RETRY_WAITS.slice(0, 2));
    expect(fake.calls.filter((args) => args.at(-1) === helper)).toHaveLength(3);
    expect(fake.calls).toHaveLength(signed.length + 2 + 1);
  });

  it('fails with codesign’s error once the waits run out', async () => {
    const app = fakeApp();
    const other = new Error('Command failed: codesign\nOmni: errSecInternalComponent');
    const fake = fakeCodesign({ [app]: Array.from({ length: OTHER_RETRY_WAITS.length + 1 }, () => other) });
    await expect(signApp(opts(app), fake.deps)).rejects.toBe(other);
    expect(fake.waits).toEqual(OTHER_RETRY_WAITS);
  });
});

describe('parseSignArgs', () => {
  it('needs the identity, the keychain, the entitlements and one app', () => {
    expect(parseSignArgs(['--identity', 'H', '--keychain', 'k', '--entitlements', 'e', 'Omni.app'])).toEqual({
      app: 'Omni.app',
      identity: 'H',
      keychain: 'k',
      entitlements: 'e',
    });
    expect(parseSignArgs(['--identity', 'H', '--keychain', 'k', 'Omni.app'])).toEqual({ error: 'needs --entitlements' });
    expect(parseSignArgs(['--identity', 'H', '--keychain', 'k', '--entitlements', 'e'])).toEqual({ error: 'needs one .app' });
    expect(parseSignArgs(['--identity', 'H', '--keychain', 'k', '--entitlements', 'e', 'a.app', 'b.app'])).toEqual({ error: 'needs one .app' });
    expect(parseSignArgs(['--ident', 'H'])).toEqual({ error: 'unknown option --ident' });
  });
});
