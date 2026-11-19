// What a message kept for a thread's first start says while the thread is not ready (apps/server/runner/setup.ts):
// its worktree is still being made or failed, or it waits for a sign-in to an account its job needs.

export interface SetupWait {
  /** Above the kept messages. */
  heading: string;
  /** On each one. */
  label: string;
}

export function setupWait(setup: string | null | undefined): SetupWait | null {
  if (!setup) return null;
  if (setup === 'signin') return { heading: 'Sends once you sign in', label: 'Waits for a sign-in' };
  return { heading: 'Sends once the worktree is ready', label: 'Waits for the worktree' };
}
