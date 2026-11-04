/**
 * One Cursor cloud agent run, in the transcript of a thread on the cursor-cloud harness. The server stores a
 * `cloud_agent` row each time the run's status, branch or PR moves; the clients fold them into one card per run, at
 * the run's first row, showing the newest state.
 * - status: CREATING "Starting" (queued glyph), RUNNING "Working" (running ping), FINISHED "Finished" (volt),
 *   ERROR "Error" and EXPIRED "Expired" (needs diamond), CANCELLED "Stopped" (settled).
 * - meta line: "Cursor cloud agent · acme/widgets from main" (the starting ref only when Cursor reported one).
 * - git line, once the agent pushed: the branch in mono, then "PR #42" linking the pull request.
 * - "Open in Cursor" always links the agent on cursor.com.
 * Colour stays on the status pill only. On the phone the card fills the turn's width.
 * @startingPoint section="Thread" subtitle="Cursor cloud agent run: starting, working, finished with a PR, stopped, error; phone" viewport="760x640"
 */
export function CloudAgentCard(props: {
  /** The agent's name, from the thread title. */
  name?: string;
  status?: 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';
  /** owner/name of the channel's GitHub repo. */
  repo?: string;
  /** The branch it started from, when Cursor reported it. Not `ref`: React reserves that prop. */
  startingRef?: string;
  /** The branch it pushed. */
  branch?: string;
  prUrl?: string;
  /** The agent on cursor.com. */
  url?: string;
  /** Phone layout: 20px radius, a little tighter. */
  mobile?: boolean;
}): JSX.Element;
