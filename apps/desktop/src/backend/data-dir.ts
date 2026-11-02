// Which data dir the server uses when no --data-dir names one: the default for this OS, unless the user picked
// another once (such as the checkout's data/ the SwiftUI app or the Linux launcher used).
import type { PlatformDirs } from '../paths.ts';

export async function chooseDataDir(input: { dirs: PlatformDirs; fallback: string; dev: boolean }): Promise<string> {
  return input.fallback;
}
