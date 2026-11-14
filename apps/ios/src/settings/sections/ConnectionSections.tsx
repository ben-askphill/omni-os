import type { OmniApi } from '@omni/client-core';
import { relTime } from '@omni/shared/format.ts';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useLink } from '../../live/react';
import { useRemote } from '../../live/use-remote';
import type { RootStackParamList } from '../../navigation/types';
import { usePairing } from '../../pairing/PairingProvider';
import { ListRow } from '../../ui/GroupedList';
import { loadMcpClients, McpClientsGroup, RotateTokenGroup } from '../AccessPieces';
import { ConfigForm } from '../ConfigForm';
import { Footnote, Group, ServerOptionsGroup, SettingsPage, StatusValue } from '../parts';
import { syncLine } from '../sync-model';
import { loadRefused, loadSyncKeys, RefusedChangesGroup, SyncKeysGroup } from '../SyncKeys';
import { loadFleet, UpdateMachinesGroup } from '../UpdateMachines';
import { Loading, useSetup } from './OmniSections';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const loadStatus = (api: OmniApi) => api.status();
const loadSync = (api: OmniApi) => api.syncStatus();

/** Machines: the machine the server runs on, Update all machines, as the Web UI's Machines section shows them, and its .env options. */
export function MachinesSection() {
  const status = useRemote(loadStatus);
  const sync = useRemote(loadSync);
  const fleet = useRemote(loadFleet);
  const { activeServer } = usePairing();
  const link = useLink();
  const synced = syncLine(sync.data, Date.now());
  return (
    <SettingsPage onRefresh={() => Promise.all([status.reload(), sync.reload(), fleet.reload()])}>
      <Group title="Current machine" footer="The machine Omni runs on, as your other machines and the sync list name it.">
        <ListRow first title="Machine" value={status.data?.device?.name ?? '…'} />
        <ListRow title="Sync" trailing={<StatusValue glyph={synced.glyph} text={synced.text} />} />
        <ListRow title="Address" detail={activeServer?.origin} />
        <ListRow title="Feed" trailing={<StatusValue glyph={link.kind === 'live' ? 'done' : 'needs'} text={link.kind === 'live' ? 'Connected' : 'Reconnecting'} />} />
      </Group>
      <UpdateMachinesGroup fleet={fleet} />
      <ServerOptionsGroup section="machines" />
    </SettingsPage>
  );
}

/**
 * Sync: its state, read-only, then each machine's signing key with Confirm new key, and the refused changes. Signing in
 * opens Cloudflare in the browser of the machine that syncs.
 */
export function SyncSection() {
  const sync = useRemote(loadSync);
  const keys = useRemote(loadSyncKeys);
  const refused = useRemote(loadRefused);
  const s = sync.data;
  const line = syncLine(s, Date.now());
  return (
    <SettingsPage onRefresh={() => Promise.all([sync.reload(), keys.reload(), refused.reload()])}>
      {s ? (
        <Group title="Sync" footer="Signing in, pausing, Sync now and the path map are on the computer: signing in opens Cloudflare in that machine's browser.">
          <ListRow first title="Status" trailing={<StatusValue glyph={line.glyph} text={line.text} />} />
          {s.lastSyncAt ? <ListRow title="Last sync" value={relTime(s.lastSyncAt)} /> : null}
          {s.configured ? <ListRow title="Waiting to send" value={String(s.pending)} /> : null}
          {s.configured ? <ListRow title="Runs automations" value={s.automations.isThisMac ? 'This machine' : (s.automations.owner ?? 'None')} /> : null}
        </Group>
      ) : (
        <Loading error={sync.error} retry={sync.reload} />
      )}
      <SyncKeysGroup remote={keys} />
      <RefusedChangesGroup remote={refused} />
    </SettingsPage>
  );
}

/**
 * Sharing & access: who is signed in, with Revoke, Rotate install token, the MCP clients with Approve and Remove, and
 * the network settings, which only the file sets.
 */
export function AccessSection() {
  const navigation = useNavigation<Nav>();
  const setup = useSetup();
  const mcp = useRemote(loadMcpClients);
  return (
    <SettingsPage onRefresh={() => Promise.all([setup.reload(), mcp.reload()])}>
      <Group title="Signed-in devices">
        <ListRow first icon="devices" title="Devices" detail="Where this server is signed in" chevron onPress={() => navigation.navigate('Devices')} />
      </Group>
      <RotateTokenGroup />
      <McpClientsGroup remote={mcp} />
      {setup.data ? <ConfigForm page="access" state={setup.data} onSaved={setup.setData} /> : <Loading error={setup.error} retry={setup.reload} />}
      <Footnote>Google sign-in, Omni Connect and pairing a phone start on the computer.</Footnote>
    </SettingsPage>
  );
}
