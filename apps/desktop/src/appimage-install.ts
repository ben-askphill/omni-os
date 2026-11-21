// Puts a downloaded update in the running AppImage's place, on Linux. electron-updater's own install
// (AppImageUpdater.doInstall) deletes the AppImage first and only then moves the download over: when the download has
// gone from its cache by then, the machine is left with no AppImage at all. Here the AppImage stays until a copy of
// the download sits next to it, and one rename swaps the two, so a failure at any step keeps this version.
import * as nodeFs from 'node:fs';
import { basename, dirname, join } from 'node:path';

type InstallFs = Pick<typeof nodeFs, 'existsSync' | 'copyFileSync' | 'chmodSync' | 'renameSync' | 'rmSync'>;

export type AppImageInstall = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Where the update goes, as electron-updater decides it: over the AppImage, or, when the AppImage's own name carries a
 * version, beside it under the download's name.
 */
export function installTarget(appImage: string, installer: string): string {
  const name = basename(appImage);
  if (basename(installer) === name || !/\d+\.\d+\.\d+/.test(name)) return appImage;
  return join(dirname(appImage), basename(installer));
}

/** Installs `installer` (the updater's download) over `appImage`, or says why it did not and left `appImage` as it was. */
export function installAppImage(appImage: string, installer: string | null, fs: InstallFs = nodeFs): AppImageInstall {
  if (!installer) return { ok: false, reason: 'the updater has no downloaded file' };
  if (!fs.existsSync(installer)) return { ok: false, reason: `the downloaded file is gone: ${installer}` };
  const target = installTarget(appImage, installer);
  // In the target's folder, so the last rename stays on one file system and replaces the target in one step.
  const staged = join(dirname(target), `.${basename(target)}.update-${process.pid}`);
  try {
    fs.copyFileSync(installer, staged, nodeFs.constants.COPYFILE_FICLONE);
    fs.chmodSync(staged, 0o755);
    fs.renameSync(staged, target);
  } catch (err) {
    fs.rmSync(staged, { force: true });
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  // Installed: the cached download and an AppImage under the old version's name are left over.
  fs.rmSync(installer, { force: true });
  if (target !== appImage) fs.rmSync(appImage, { force: true });
  return { ok: true, path: target };
}
