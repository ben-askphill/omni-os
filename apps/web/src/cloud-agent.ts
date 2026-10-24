// A Cursor cloud agent's run as the card shows it (transcript/fold.ts folds its rows). Pure, so it is testable.
import type { CloudAgentP } from './transcript/fold.ts';

/** Each run status as a thread status (for the pill's glyph) and the word the card says. */
export const CLOUD_STATUS: Record<CloudAgentP['status'], { status: string; label: string }> = {
  CREATING: { status: 'queued', label: 'Starting' },
  RUNNING: { status: 'running', label: 'Working' },
  FINISHED: { status: 'done', label: 'Finished' },
  ERROR: { status: 'failed', label: 'Error' },
  CANCELLED: { status: 'stopped', label: 'Stopped' },
  EXPIRED: { status: 'failed', label: 'Expired' },
};

/** An unknown status reads as working: the server only sends the ones above. */
export const cloudStatus = (s: string) => CLOUD_STATUS[s as CloudAgentP['status']] ?? CLOUD_STATUS.RUNNING;

/** `#42` from a GitHub pull request URL, or null for anything else. */
export function prNumber(url: string | undefined): string | null {
  const m = url?.match(/\/pull\/(\d+)(?:[/?#]|$)/);
  return m ? `#${m[1]}` : null;
}

/** The agent on cursor.com, from a thread's session id once it is one (`bc-…`). */
export const cloudAgentUrl = (sessionId: string) => (sessionId.startsWith('bc-') ? `https://cursor.com/agents/${sessionId}` : null);
