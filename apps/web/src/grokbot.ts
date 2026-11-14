import { api, errorText } from './api.ts';

export type GrokBotSent = { ok: true } | { ok: false; error: string };

async function post(body: { thread_id: string } | { request: string; context: { channel_id: string } }): Promise<GrokBotSent> {
  try {
    await api.post<{ ok: boolean }>('/grokbot', body);
    return { ok: true };
  } catch (e) {
    // The server's own words: which secret is missing, the webhook's HTTP status, or why it could not be reached.
    return { ok: false, error: errorText(e) };
  }
}

/** POST /api/grokbot for one thread. The server reads the thread's text and adds its channel and thread ids. */
export const sendThreadToGrokBot = (threadId: string) => post({ thread_id: threadId });

/**
 * POST /api/grokbot with what the new-thread composer holds, when its Machine chip is on Grok Bot: the text and the
 * channel it was written in. No thread is created.
 */
export const sendMessageToGrokBot = (request: string, channelId: string) => post({ request, context: { channel_id: channelId } });
