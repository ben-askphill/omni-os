import type { OmniApi } from '@omni/client-core';
import { isAccountsMessage, usageRows } from '@omni/shared/account-usage.ts';
import { HARNESS } from '@omni/shared/brand.ts';
import {
  DEFAULT_USAGE_PANEL,
  entryDetail,
  isDefaultUsagePanel,
  isUsagePanelMessage,
  PANEL_HARNESSES,
  panelEntries,
  parseUsagePanel,
  withMoved,
  withShown,
  type PanelEntry,
  type UsagePanelPrefs,
} from '@omni/shared/usage-panel.ts';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { useLiveHub } from '../../live/react';
import { useRemote } from '../../live/use-remote';
import { fontSize, lineHeight, minTarget, space, useOmniTheme } from '../../theme';
import { HarnessLogo } from '../../ui/Brand';
import { Callout } from '../../ui/Callout';
import { ListRow } from '../../ui/GroupedList';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { Group, SettingsPage } from '../parts';
import { Loading } from './OmniSections';

// Settings > Usage panel on the phone: the same rows and switches as the Web UI, moved with Move up and Move down
// buttons instead of a drag. The server keeps the choice and syncs it to every machine.

const loadAccounts = (api: OmniApi) => api.accounts();
const loadPanel = async (api: OmniApi) => parseUsagePanel(await api.usagePanel());

const labelOf = (h: string) => HARNESS[h]?.label ?? h;
const nameOf = (e: PanelEntry) => (e.account ? `${labelOf(e.harness)}, ${e.account.label}` : labelOf(e.harness));

export function UsagePanelSection() {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const accounts = useRemote(loadAccounts);
  const panel = useRemote(loadPanel);
  const [error, setError] = useState<string | null>(null);
  const { reload: reloadAccounts } = accounts;
  const { reload: reloadPanel, setData: setPanel } = panel;
  useEffect(
    () =>
      hub.watchFeed((message) => {
        if (isUsagePanelMessage(message)) void reloadPanel();
        else if (isAccountsMessage(message)) void reloadAccounts();
      }),
    [hub, reloadAccounts, reloadPanel],
  );

  const prefs = panel.data ?? DEFAULT_USAGE_PANEL;
  const entries = useMemo(() => (accounts.data ? panelEntries(usageRows(PANEL_HARNESSES, accounts.data, []), prefs) : null), [accounts.data, prefs]);
  const save = async (next: UsagePanelPrefs) => {
    const before = prefs;
    setError(null);
    setPanel(next);
    try {
      setPanel(parseUsagePanel(await hub.request((api) => api.setUsagePanel(next))));
    } catch (e) {
      setPanel(before);
      setError(e instanceof Error ? e.message : 'Could not save the Usage panel.');
    }
  };

  return (
    <SettingsPage onRefresh={() => Promise.all([reloadAccounts(), reloadPanel()])}>
      {error ? <Callout message={error} /> : null}
      {entries && panel.data ? (
        <>
          <Group title="Rows and order" footer="The Usage panel shows these top to bottom, on every device and machine. An account that signs in later joins at the end.">
            {entries.map((e, i) => {
              const name = nameOf(e);
              return (
                <View key={e.key} style={[styles.row, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <HarnessLogo harness={e.harness} />
                  <View style={styles.grow}>
                    <Text style={[styles.title, { color: colors.fg }]}>{labelOf(e.harness)}</Text>
                    <Text style={[styles.detail, { color: e.shown ? colors.fg2 : colors.fg3 }]} numberOfLines={1}>
                      {entryDetail(e)}
                    </Text>
                  </View>
                  <MoveButton label={`Move ${name} up`} icon="arrowUp" disabled={i === 0} onPress={() => void save(withMoved(prefs, entries, e.key, -1))} />
                  <MoveButton label={`Move ${name} down`} icon="arrowDown" disabled={i === entries.length - 1} onPress={() => void save(withMoved(prefs, entries, e.key, 1))} />
                  <Switch accessibilityLabel={`Show ${name}`} value={e.shown} onValueChange={(shown) => void save(withShown(prefs, entries, e.key, shown))} />
                </View>
              );
            })}
          </Group>
          {!isDefaultUsagePanel(prefs) ? (
            <Group>
              <ListRow first title="Reset to the built-in order" icon="undo" onPress={() => void save(DEFAULT_USAGE_PANEL)} />
            </Group>
          ) : null}
        </>
      ) : (
        <Loading error={accounts.error ?? panel.error} retry={() => Promise.all([reloadAccounts(), reloadPanel()]).then(() => {})} />
      )}
    </SettingsPage>
  );
}

function MoveButton({ label, icon, disabled, onPress }: { label: string; icon: 'arrowUp' | 'arrowDown'; disabled: boolean; onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.move, pressed && { backgroundColor: colors.wash }]}
    >
      <Icon name={icon} size={16} color={disabled ? colors.fg4 : colors.fg2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    paddingLeft: space.s8,
    paddingRight: space.s6,
    paddingVertical: space.s5,
  },
  grow: { flex: 1, gap: space.s1 },
  title: { fontSize: fontSize.subhead },
  detail: { fontSize: fontSize.small, lineHeight: Math.round(fontSize.small * lineHeight.body) },
  move: { width: 36, height: minTarget, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
});
