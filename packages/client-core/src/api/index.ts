// The wire shapes are copied here because this package imports neither the server nor the Web UI. Replies are cast to
// them, not validated. One file per domain: a domain owns its types and the calls that return them.
import type { HttpClient } from '../http.ts';
import { accountApi } from './account.ts';
import { actionsApi } from './actions.ts';
import { activityApi } from './activity.ts';
import { artifactsApi } from './artifacts.ts';
import { automationsApi } from './automations.ts';
import { changesApi } from './changes.ts';
import { claudeArtifactsApi } from './claude-artifacts.ts';
import { commandsApi } from './commands.ts';
import { channelsApi } from './channels.ts';
import { continueApi } from './continue.ts';
import { crewApi } from './crew.ts';
import { detailApi } from './detail.ts';
import { harnessesApi } from './harnesses.ts';
import { machinesApi } from './machines.ts';
import { membersApi } from './members.ts';
import { memoryApi } from './memory.ts';
import { messagesApi } from './messages.ts';
import { needsYouApi } from './needs-you.ts';
import { pushApi } from './push.ts';
import { pullsApi } from './pulls.ts';
import { recoveryApi } from './recovery.ts';
import { searchApi } from './search.ts';
import { settingsApi } from './settings.ts';
import { tasksApi } from './tasks.ts';
import { templatesApi } from './templates.ts';
import { threadsApi } from './threads.ts';

export * from './account.ts';
export * from './actions.ts';
export * from './activity.ts';
export * from './artifacts.ts';
export * from './automations.ts';
export * from './changes.ts';
export * from './claude-artifacts.ts';
export * from './commands.ts';
export * from './channels.ts';
export * from './continue.ts';
export * from './crew.ts';
export * from './detail.ts';
export * from './events.ts';
export * from './harnesses.ts';
export * from './machines.ts';
export * from './members.ts';
export * from './memory.ts';
export * from './messages.ts';
export * from './needs-you.ts';
export * from './push.ts';
export * from './pulls.ts';
export * from './recovery.ts';
export * from './search.ts';
export * from './settings.ts';
export * from './tasks.ts';
export * from './templates.ts';
export * from './threads.ts';

export type OmniApi = ReturnType<typeof createOmniApi>;

export function createOmniApi(http: HttpClient) {
  return {
    ...channelsApi(http),
    ...crewApi(http),
    ...threadsApi(http),
    ...membersApi(http),
    ...detailApi(http),
    ...messagesApi(http),
    ...recoveryApi(http),
    ...needsYouApi(http),
    ...harnessesApi(http),
    ...pushApi(http),
    ...activityApi(http),
    ...artifactsApi(http),
    ...claudeArtifactsApi(http),
    ...machinesApi(http),
    ...continueApi(http),
    ...searchApi(http),
    ...settingsApi(http),
    ...accountApi(http),
    ...automationsApi(http),
    ...actionsApi(http),
    ...changesApi(http),
    ...pullsApi(http),
    ...tasksApi(http),
    ...templatesApi(http),
    ...commandsApi(http),
    ...memoryApi(http),
  };
}
