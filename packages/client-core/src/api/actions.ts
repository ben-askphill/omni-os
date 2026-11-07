import type { ActionRun, ChannelAction, ChannelActionInput, ThreadActions } from '@omni/shared/channel-actions.ts';
import { apiPath, type HttpClient } from '../http.ts';

export type { ActionRun, ActionRunState, ChannelAction, ChannelActionInput, SetupMode, ThreadActions } from '@omni/shared/channel-actions.ts';

export function actionsApi(http: HttpClient) {
  return {
    /** The thread's channel's actions, the thread's latest runs of them, and why none can run now (`blocked`). */
    threadActions: (threadId: string) => http.request<ThreadActions>('GET', apiPath`/threads/${threadId}/actions`),
    /** Starts one in the thread's checkout. A 409 with the reason while `blocked`, a 404 for another channel's action. */
    runAction: (threadId: string, actionId: string) => http.request<ActionRun>('POST', apiPath`/threads/${threadId}/actions/${actionId}/run`),
    /** Stops a running run. Answers with the run as it is now. */
    stopActionRun: (threadId: string, runId: string) => http.request<ActionRun>('POST', apiPath`/threads/${threadId}/action-runs/${runId}/stop`),
    /** Runs the run's action again as a new run. A 409 while `blocked`. */
    retryActionRun: (threadId: string, runId: string) => http.request<ActionRun>('POST', apiPath`/threads/${threadId}/action-runs/${runId}/retry`),
    /** A channel's actions, in their order. */
    channelActions: (channelId: string) => http.request<ChannelAction[]>('GET', apiPath`/channels/${channelId}/actions`),
    addChannelAction: (channelId: string, input: ChannelActionInput) => http.request<ChannelAction>('POST', apiPath`/channels/${channelId}/actions`, { body: input }),
    /** Replaces the whole action, so `input` carries `setup` too. Setting `setup` on one takes it off any other. */
    updateChannelAction: (channelId: string, actionId: string, input: ChannelActionInput) =>
      http.request<ChannelAction>('PATCH', apiPath`/channels/${channelId}/actions/${actionId}`, { body: input }),
    deleteChannelAction: (channelId: string, actionId: string) => http.request<{ ok: true }>('DELETE', apiPath`/channels/${channelId}/actions/${actionId}`),
  };
}
