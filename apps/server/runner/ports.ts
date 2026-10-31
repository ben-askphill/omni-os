// What the runner asks of the modules around it, and what a thread's controller is built with. Nothing here is
// imported from those modules: apps/server/compose.ts, the one composition root, binds them, so the runner's files
// never import run-on.ts, handoff.ts or published.ts, and those may import the runner freely. Until it is bound,
// each port throws naming compose.ts, so a boot that skipped the root fails at once rather than running local-only.
// The state these ports move is drawn in docs/internals/execution-state.md.
import type { MessageContext } from '@omni/shared/message-context.ts';
import type { Thread } from '../db.ts';
import type { Attachment } from '../uploads.ts';
import type { UploadRef } from '../sync/files.ts';

/** A synced machine as the routing names it. */
export interface Mac {
  id: string;
  name: string;
}

/** The outside the runner reaches, each bound by compose.ts to the module that owns it. */
export interface RunnerPorts {
  /** Where a thread runs when not here (run-on.ts): the machine a new thread goes to, and the holder's inbox. */
  routing: {
    targetFor(asked: string | null | undefined): Promise<{ from: Mac; to: Mac } | null>;
    forwardMessage(
      t: Thread,
      prompt: string,
      opts: { mode: 'steer' | 'queue' | 'interrupt'; from: 'ben' | 'conductor'; requestId?: string; attachments?: Attachment[]; context?: MessageContext[] },
    ): Promise<unknown>;
    forwardReport(parentId: string, key: string, prompt: string, payload: Record<string, unknown>): void;
  };
  /** Sending a thread made here to run on another machine (handoff.ts). */
  handoff: {
    sendNewThread(threadId: string, prompt: string, from: Mac, to: Mac, files: UploadRef[]): void;
  };
  /** What the rest of Omni does with a tool result once it is in the transcript (published.ts, then the automations). */
  reporting: {
    toolResult(threadId: string, r: { tool_use_id: string; text: string; is_error: boolean }): void;
  };
}

/** What a thread's controller (controller.ts) is built with. Each is a seam a test can replace. */
export interface ControllerDeps {
  /** Reporting: the transcript row and the feed the clients watch. */
  reporting: {
    event(threadId: string, kind: string, payload: unknown): { id: number };
    thread(threadId: string): void;
  };
  /** Scheduling: the timers a process lives by, so a test can run them by hand. */
  scheduling: {
    after(ms: number, fn: () => void, opts?: { unref?: boolean }): unknown;
    cancel(timer: unknown): void;
  };
  /** Persistence: the thread's row and its assignment. */
  persistence: {
    /** A turn starts here: the status write claims the thread for this machine. The generation it runs on, if known. */
    claimTurn(threadId: string): number | undefined;
  };
}

const unbound = (what: string) => () => {
  throw new Error(`The runner is not composed (${what}): import apps/server/compose.ts before using it.`);
};

const ports: RunnerPorts = {
  routing: { targetFor: unbound('routing.targetFor'), forwardMessage: unbound('routing.forwardMessage'), forwardReport: unbound('routing.forwardReport') },
  handoff: { sendNewThread: unbound('handoff.sendNewThread') },
  reporting: { toolResult: unbound('reporting.toolResult') },
};

let deps: ControllerDeps | null = null;

/** The ports as bound. Read at call time, never at import, so the root may bind after the runner loaded. */
export const runnerPorts = () => ports;

/** What a new controller is built with. Throws until compose.ts bound it. */
export function controllerDeps(): ControllerDeps {
  if (!deps) unbound('controller deps')();
  return deps!;
}

/** Bind every port and the controller's deps. The composition root calls it once; a test may call it again with fakes. */
export function bindRunner(bound: { ports: RunnerPorts; deps: ControllerDeps }) {
  Object.assign(ports.routing, bound.ports.routing);
  Object.assign(ports.handoff, bound.ports.handoff);
  Object.assign(ports.reporting, bound.ports.reporting);
  deps = bound.deps;
}
