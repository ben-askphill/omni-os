// Links that leave Omni. Most go to the default browser; a claude.ai artifact goes to the Claude desktop app when this
// machine has it, through the `claude:` scheme it registers, and to the browser when it does not or the hand-off fails.
import { app, shell } from 'electron';
import { artifactOpenTargets, claudeAppLink } from '@omni/shared/claude-artifacts.ts';

/** True when an app on this machine says it handles `claude:` links. Asked per click, so it follows installs. */
function claudeAppInstalled(): boolean {
  try {
    return app.getApplicationNameForProtocol('claude://') !== '';
  } catch {
    return false;
  }
}

/** The links to try for `url`, in order. The OS is only asked about the Claude app for a claude.ai artifact link. */
export function externalTargets(url: string, installed: () => boolean = claudeAppInstalled): string[] {
  return artifactOpenTargets(url, 'desktop', claudeAppLink(url) !== null && installed());
}

/** Opens the first target that the system accepts. Throws only when the last one fails too. */
export async function openFirst(targets: string[], open: (url: string) => Promise<void>): Promise<string> {
  for (const [i, target] of targets.entries()) {
    try {
      await open(target);
      return target;
    } catch (err) {
      if (i === targets.length - 1) throw err;
    }
  }
  throw new Error('nothing to open');
}

/** Hands a link to the system: the Claude app for a claude.ai artifact when it is installed, else the default browser. */
export function openExternal(url: string): void {
  // shell.openExternal is read at call time, so a QA run's stub records the hand-off.
  void openFirst(externalTargets(url), (u) => shell.openExternal(u)).catch(() => {});
}
