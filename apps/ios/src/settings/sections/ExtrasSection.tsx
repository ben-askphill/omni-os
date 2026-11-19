import type { OmniApi } from '@omni/client-core';

import { useRemote } from '../../live/use-remote';
import { ListRow } from '../../ui/GroupedList';
import { ConfigForm } from '../ConfigForm';
import { Group, SettingsPage } from '../parts';
import { Loading, useSetup } from './OmniSections';

const loadStatus = (api: OmniApi) => api.status();

/** Extras: the optional add-ons. Wispr Flow lives in the Mac app; Grok Bot turns on with its secrets; then Hermes and the notes folder. */
export function ExtrasSection() {
  const setup = useSetup();
  const status = useRemote(loadStatus);
  const grok = status.data ? (status.data.grokBot ? 'On' : 'Off') : status.error ? 'Unknown' : '…';
  return (
    <SettingsPage onRefresh={() => Promise.all([setup.reload(), status.reload()])}>
      <Group title="Wispr Flow" footer="Dictates into the Quick Prompt in Omni's Mac app. Turn it on there, under Settings > Extras.">
        <ListRow first title="Dictate with Wispr Flow" value="Mac app" />
      </Group>
      <Group title="Grok Bot" footer="Hands a thread or a request to your Grok Bot. It turns on once the server has the global secrets GROKBOT_WEBHOOK_URL and GROKBOT_WEBHOOK_AUTH.">
        <ListRow first title="Send to Grok Bot" value={grok} />
      </Group>
      {setup.data ? (
        <ConfigForm page="extras" state={setup.data} onSaved={setup.setData} footer="HERMES_API_KEY is under Secrets. The notes folder is a path on the server's machine, so it changes on that computer." />
      ) : (
        <Loading error={setup.error} retry={setup.reload} />
      )}
    </SettingsPage>
  );
}
