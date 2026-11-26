// get_thread's reply options, the same on the Conductor's server (omni.ts) and the external one (external/tools.ts).
// The summary route reads them (apps/server/thread-routes-api.ts lastReply).
import { z } from 'zod';
import { REPORT_MAX_CHARS } from '@omni/shared/report-shape.ts';

export const replyInput = {
  include_reply: z.boolean().optional().describe('false leaves last_reply out, for a status or warmth check. Default true.'),
  reply_max_chars: z
    .number()
    .int()
    .min(200)
    .max(60_000)
    .optional()
    .describe(`Cut last_reply at this many characters, with a marker. Default ${REPORT_MAX_CHARS.toLocaleString('en-US')}.`),
};

/** The summary route's query for those options: no reply, or the reply cut at the limit. */
export const replyQuery = (include?: boolean, max?: number) => (include === false ? 'reply=0' : `reply_max=${max ?? REPORT_MAX_CHARS}`);
