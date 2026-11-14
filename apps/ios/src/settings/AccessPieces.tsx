import type { McpClient, OmniApi } from '@omni/client-core';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { useLiveHub } from '../live/react';
import type { Remote } from '../live/use-remote';
import { usePairing } from '../pairing/PairingProvider';
import { space, useOmniTheme } from '../theme';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { ListRow } from '../ui/GroupedList';
import {
  mcpClientRows,
  removeClientConfirmation,
  ROTATE_CONFIRMATION,
  ROTATE_LABEL,
  rotateFailure,
  withClient,
  withoutClient,
  type McpClientRow,
} from './access-model';
import { loadOptional, optionalView, type Optional } from './optional-remote';
import { Footnote, Group } from './parts';

// Settings, Sharing & access: Rotate install token and the MCP clients list, as the Web UI's section has them. Both
// hide on a server that predates them (a 404).

const failed = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.');

export const loadMcpClients = (api: OmniApi) => loadOptional(api.mcpClients());

/**
 * Rotate install token. Rotating ends every device session, this phone's too, so after it the pairing check finds the
 * server no longer accepts the phone, forgets it and shows Connect, the same path a revoke from the computer takes.
 */
export function RotateTokenGroup() {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const { activeServer, confirmSignedIn } = usePairing();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  if (missing) return <Footnote>{missing}</Footnote>;

  async function rotate() {
    setBusy(true);
    setError(null);
    try {
      await hub.request((api) => api.rotateInstallToken());
    } catch (e) {
      const f = rotateFailure(e);
      if (f.kind === 'missing') setMissing(f.message);
      else setError(f.message);
      setBusy(false);
      return;
    }
    if (activeServer) await confirmSignedIn(activeServer.id).catch(() => false);
    setBusy(false);
  }

  function confirm() {
    Alert.alert(ROTATE_CONFIRMATION.title, ROTATE_CONFIRMATION.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: ROTATE_CONFIRMATION.confirmLabel, style: 'destructive', onPress: () => void rotate() },
    ]);
  }

  return (
    <View style={styles.stack}>
      <Group title="Install token" footer="A new token for this server. Every signed-in device has to pair again, and the desktop app pairs again by itself.">
        <ListRow
          first
          icon="refresh"
          title={ROTATE_LABEL}
          tone="destructive"
          disabled={busy}
          onPress={confirm}
          trailing={busy ? <ActivityIndicator accessibilityLabel="Rotating" color={colors.fg3} /> : undefined}
        />
      </Group>
      {error ? <Callout message={error} /> : null}
    </View>
  );
}

/** MCP clients: who signed in to /mcp with OAuth, first and last seen, Approve on a pending or bound one and Remove. */
export function McpClientsGroup({ remote }: { remote: Remote<Optional<McpClient[]>> }) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const { data, reload, setData } = remote;
  const [acting, setActing] = useState<{ id: string; action: 'approve' | 'remove' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clients = data && !data.missing ? data.value : null;
  const rows = useMemo(() => mcpClientRows(clients ?? [], Date.now()), [clients]);
  const view = optionalView(remote);

  if (view === 'hidden') return null;
  if (view === 'loading') return <ActivityIndicator accessibilityLabel="Loading MCP clients" color={colors.fg3} />;
  if (view === 'error')
    return (
      <Group title="MCP clients" footer={`Couldn't load them: ${remote.error}`}>
        <ListRow first title="Try again" icon="refresh" onPress={() => void reload()} />
      </Group>
    );

  async function act(row: McpClientRow, action: 'approve' | 'remove', call: (api: OmniApi) => Promise<McpClient[]>) {
    setActing({ id: row.id, action });
    setError(null);
    try {
      const next = await hub.request(call);
      setData({ missing: false, value: next });
      void reload();
    } catch (e) {
      setError(failed(e));
    } finally {
      setActing(null);
    }
  }

  const approve = (row: McpClientRow) =>
    void act(row, 'approve', async (api) => withClient(clients ?? [], await api.approveMcpClient(row.id)));

  function remove(row: McpClientRow) {
    const { title, message } = removeClientConfirmation(row);
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void act(row, 'remove', async (api) => {
            await api.removeMcpClient(row.id);
            return withoutClient(clients ?? [], row.id);
          }),
      },
    ]);
  }

  return (
    <View style={styles.stack}>
      <Group title="MCP clients" footer="Assistants such as claude.ai that signed in to this server's /mcp with your Google account. A pending one works once you approve it.">
        {rows.length ? (
          rows.map((row, i) => (
            <ListRow
              key={row.id}
              first={i === 0}
              title={row.name}
              detail={row.hint ? `${row.detail}\n${row.hint}` : row.detail}
              trailing={
                <View style={styles.buttons}>
                  {row.approveLabel ? (
                    <Button
                      label="Approve"
                      variant="secondary"
                      size="small"
                      accessibilityLabel={row.approveLabel}
                      busy={acting?.id === row.id && acting.action === 'approve'}
                      disabled={acting !== null}
                      onPress={() => approve(row)}
                    />
                  ) : null}
                  <Button
                    label="Remove"
                    variant="ghost"
                    size="small"
                    accessibilityLabel={row.removeLabel}
                    busy={acting?.id === row.id && acting.action === 'remove'}
                    disabled={acting !== null}
                    onPress={() => remove(row)}
                  />
                </View>
              }
            />
          ))
        ) : (
          <ListRow first title="No MCP clients yet" />
        )}
      </Group>
      {error ? <Callout message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space.s4,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
  },
});
