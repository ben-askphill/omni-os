// Builds the desktop app for one platform and arch: dist/ (build.ts), build/omni (stage.ts), then electron-builder
// with electron-builder.config.cjs. Artifacts land in release/. It never uploads: the release workflow's publish job
// does (.github/workflows/desktop-release.yml).
//
//   tsx scripts/dist.ts [--platform mac|linux] [--arch arm64|x64|universal] [--dir] [--prepackaged <app>] [--skip-web] [--host-glibc] [--native required|off] [-- builder args]
//
//   --dir         the unpacked app only (release/mac-<arch>/Omni.app, release/linux-unpacked), no DMG or AppImage
//   --prepackaged packs an app built and signed before into the DMG, zip, AppImage and update feed, and builds
//                 nothing. The release workflow packs its signed Mac app with scripts/mac-release-package.ts instead
//   --skip-web    use apps/web/dist as it is
//   --host-glibc  a Linux build that only has to run on this machine (stage.ts)
//   --native      required (the default) or off: whether the Rust binaries go in (stage.ts)
//   --          the rest goes to electron-builder, like: -- -c.extraMetadata.version=0.1.1
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseStageArgs, stage } from './stage.ts';

const DESKTOP = resolve(import.meta.dirname, '..');

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: DESKTOP, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status ?? result.signal}`);
}

/** electron-builder's flags for a staged target. */
export function builderArgs(input: {
  platform: 'darwin' | 'linux';
  arch: 'x64' | 'arm64' | 'universal';
  dir: boolean;
  prepackaged?: string;
  extra?: string[];
}): string[] {
  return [
    '--config',
    join(DESKTOP, 'electron-builder.config.cjs'),
    input.platform === 'darwin' ? '--mac' : '--linux',
    `--${input.arch}`,
    ...(input.dir ? ['--dir'] : []),
    ...(input.prepackaged ? ['--prepackaged', input.prepackaged] : []),
    ...(input.extra ?? []),
    '--publish',
    'never',
  ];
}

async function main(argv: string[]): Promise<void> {
  const split = argv.indexOf('--');
  const own = split < 0 ? argv : argv.slice(0, split);
  const extra = split < 0 ? [] : argv.slice(split + 1);
  const dir = own.includes('--dir');
  const at = own.indexOf('--prepackaged');
  const prepackaged = at < 0 ? undefined : own[at + 1];
  if (at >= 0 && (!prepackaged || prepackaged.startsWith('-'))) {
    console.error('dist: --prepackaged needs the path of the app');
    process.exit(2);
  }
  if (dir && prepackaged) {
    console.error('dist: --dir builds the app that --prepackaged takes as built');
    process.exit(2);
  }
  const parsed = parseStageArgs(
    own.filter((arg, i) => arg !== '--dir' && (at < 0 || (i !== at && i !== at + 1))),
    process,
  );
  if ('error' in parsed) {
    console.error(`dist: ${parsed.error}`);
    process.exit(2);
  }
  const { target } = parsed;
  if (target.platform === 'darwin' && process.platform !== 'darwin') {
    console.error('dist: a Mac build needs a Mac (codesign, hdiutil and lipo)');
    process.exit(2);
  }
  if (!prepackaged) {
    console.log('==> Building dist/');
    run('npx', ['--no-install', 'tsx', 'scripts/build.ts']);
    await stage(parsed);
  }
  console.log('==> Packaging with electron-builder');
  const arch = target.arches.length > 1 ? 'universal' : target.arches[0];
  run('npx', ['--no-install', 'electron-builder', ...builderArgs({ platform: target.platform, arch, dir, prepackaged: prepackaged && resolve(prepackaged), extra })]);
  console.log(`==> Done: ${join(DESKTOP, 'release')}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`dist: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
