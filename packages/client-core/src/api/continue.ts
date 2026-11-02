import type { ContinueBody, ContinuePreview } from '@omni/shared/continue.ts';
import type { Run } from '@omni/shared/run-switch.ts';
import { apiPath, type HttpClient } from '../http.ts';
import type { Thread } from './threads.ts';

/** POST /threads/:id/continue/preview: the run to read the Carryover for, and the source's attachments to carry. */
export interface ContinuePreviewRequest extends Run {
  /** The ids of the source's attachments picked (`CarryoverAttachment.id`). None by default. */
  attachments?: readonly string[];
}

/** POST /threads/:id/continue. `duplicate`: the request id had already started this thread, so it is that one. */
export interface ContinueAnswer {
  thread: Thread;
  duplicate: boolean;
}

/** The shell DELETE /threads/:id/terminal leaves: closed. */
export interface TerminalInfo {
  open: boolean;
  running: boolean;
  code: number | null;
}

export function continueApi(http: HttpClient) {
  return {
    /** The Carryover the picked run would read, the revision a start must name, and what keeps the thread from it now (`blocked`). */
    continuePreview: (threadId: string, body: ContinuePreviewRequest) =>
      http.request<ContinuePreview>('POST', apiPath`/threads/${threadId}/continue/preview`, { body }),
    /**
     * Starts the continued thread. Keep `request_id` across retries of the same start. A 409 says why it did not: its
     * `failure.body` is `{code: 'busy', block}`, `{code: 'changed', preview}` or `{code: 'request_reused'}`, which
     * `startError` in @omni/shared/continue-flow.ts reads.
     */
    continueThread: (threadId: string, body: ContinueBody) => http.request<ContinueAnswer>('POST', apiPath`/threads/${threadId}/continue`, { body }),
    /** Closes the shell open in the thread's Terminal tab, which blocks continuing it (a `terminal` block). */
    closeTerminal: (threadId: string) => http.request<TerminalInfo>('DELETE', apiPath`/threads/${threadId}/terminal`),
  };
}
