// The app's updater, reported to the server it started (POST /api/update/desktop, packages/shared/update-fleet.ts).
// That server is a detached child with no channel back to this process, so the report is how it learns the updater's
// state and how a fleet ask reaches the updater: the answer carries the command to carry out. One report is in
// flight at a time, so a burst of view changes costs one more. A command is carried out once and named in the next
// report, which stops the server handing it out.
import type { DesktopUpdateCommand, DesktopUpdateReport } from '@omni/shared/update-fleet.ts';
import { parseCommand } from './update-state.ts';

export interface UpdateReporterDeps {
  /** False while there is nothing to report to: a server this app did not start, one that is not ready, no updater. */
  canReport(): boolean;
  current(): Pick<DesktopUpdateReport, 'version' | 'view'>;
  /** The server's answer, as it came. */
  send(report: DesktopUpdateReport): Promise<unknown>;
  /** Acts on a command. False when the view does not let it yet: it stays pending and the server hands it out again. */
  carryOut(command: DesktopUpdateCommand): boolean;
  /** The first failed report. A server that is down, restarting or too old to take reports fails every one after. */
  onFirstFailure(err: unknown): void;
}

/** Reports now, or right after the report in flight. A failed report is quiet: the next view change or tick tries again. */
export function createUpdateReporter(deps: UpdateReporterDeps): () => Promise<void> {
  let done: string | null = null;
  let sending = false;
  let sendAgain = false;
  let failed = false;
  return async () => {
    if (sending) {
      sendAgain = true;
      return;
    }
    sending = true;
    try {
      do {
        sendAgain = false;
        if (!deps.canReport()) return;
        const command = parseCommand(await deps.send({ ...deps.current(), done }));
        // Named in the very next report, so the server stops handing it out.
        if (command && command.id !== done && deps.carryOut(command)) {
          done = command.id;
          sendAgain = true;
        }
      } while (sendAgain);
    } catch (err) {
      if (!failed) deps.onFirstFailure(err);
      failed = true;
    } finally {
      sending = false;
    }
  };
}
