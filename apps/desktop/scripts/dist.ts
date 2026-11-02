// Builds the desktop app for one platform and arch: dist/ (build.ts), build/omni (stage.ts), then electron-builder
// with electron-builder.config.cjs. Artifacts land in release/. It never publishes.
//
//   tsx scripts/dist.ts [--platform mac|linux] [--arch arm64|x64|universal] [--dir] [--skip-web] [--host-glibc] [-- builder args]
//
//   --dir         the unpacked app only (release/mac-<arch>/Omni.app, release/linux-unpacked), no DMG or AppImage
//   --skip-web    use apps/web/dist as it is
//   --host-glibc  a Linux build that only has to run on this machine (stage.ts)
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
export function builderArgs(input: { platform: 'darwin' | 'linux'; arch: 'x64' | 'arm64' | 'universal'; dir: boolean; extra?: string[] }): string[] {
  return [
    '--config',
    join(DESKTOP, 'electron-builder.config.cjs'),
    input.platform === 'darwin' ? '--mac' : '--linux',
    `--${input.arch}`,
    ...(input.dir ? ['--dir'] : []),
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
  const parsed = parseStageArgs(
    own.filter((arg) => arg !== '--dir'),
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
  console.log('==> Building dist/');
  run('npx', ['--no-install', 'tsx', 'scripts/build.ts']);
  await stage(parsed);
  console.log('==> Packaging with electron-builder');
  const arch = target.arches.length > 1 ? 'universal' : target.arches[0];
  run('npx', ['--no-install', 'electron-builder', ...builderArgs({ platform: target.platform, arch, dir, extra })]);
  console.log(`==> Done: ${join(DESKTOP, 'release')}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`dist: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
