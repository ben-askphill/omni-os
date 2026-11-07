import type { OmniApi, SecretRow } from '@omni/client-core';
import { relTime } from '@omni/shared/format.ts';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { useChannels, useLiveHub } from '../live/react';
import { useRemote } from '../live/use-remote';
import type { RootScreenProps } from '../navigation/types';
import { channelTitle } from '../settings/channel-settings-model';
import { Footnote, Group, InputRow, SaveRow, SettingsPage } from '../settings/parts';
import { Loading } from '../settings/sections/OmniSections';
import { channelScope, GLOBAL_SCOPE, scopeLabel, secretGroups, secretProblem } from '../settings/secrets-model';
import { space } from '../theme';
import { ListRow } from '../ui/GroupedList';
import { OptionGroup, OptionRow } from '../ui/OptionRow';
import { Sheet } from '../ui/Sheet';

const loadSecrets = (api: OmniApi) => api.secrets();

/**
 * Settings, Secrets, or one channel's from its settings: the names by scope and a form that adds or replaces one. A value
 * goes to the server's secret store and never comes back, as on the Web UI. A channel secret overrides a global one.
 */
export function SecretsScreen({ route }: RootScreenProps<'Secrets'>) {
  const channelId = route.params?.channel;
  const hub = useLiveHub();
  const { channels } = useChannels();
  const remote = useRemote(loadSecrets);
  const [scope, setScope] = useState(channelId ? channelScope(channelId) : GLOBAL_SCOPE);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const nameOf = (id: string) => channels?.find((c) => c.id === id)?.name;
  const label = (s: string) => scopeLabel(s, nameOf);
  const groups = remote.data ? secretGroups(remote.data, channelId) : [];
  const scopes = [GLOBAL_SCOPE, ...(channels ?? []).filter((c) => !c.archived).map((c) => channelScope(c.id))];

  async function save() {
    const problem = secretProblem(name, value);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await hub.request((api) => api.setSecret(scope, name, value));
      const replaced = remote.data?.some((s) => s.scope === scope && s.name === name);
      setSaved(`${replaced ? 'Replaced' : 'Saved'} ${name} (${label(scope)})`);
      setName('');
      setValue('');
      await remote.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function open(row: SecretRow) {
    Alert.alert(row.name, `${label(row.scope)}. The value stays in the server's secret store.`, [
      {
        text: 'Replace value',
        onPress: () => {
          setScope(row.scope);
          setName(row.name);
          setValue('');
          setSaved(null);
        },
      },
      { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(row) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmDelete(row: SecretRow) {
    Alert.alert(`Delete ${row.name}?`, `Threads in ${label(row.scope) === 'Global' ? 'every channel' : label(row.scope)} stop getting it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void hub
            .request((api) => api.deleteSecret(row.scope, row.name))
            .then(() => remote.reload())
            .catch((e: unknown) => Alert.alert("Couldn't delete the secret", e instanceof Error ? e.message : 'Something went wrong. Try again.')),
      },
    ]);
  }

  return (
    <SettingsPage onRefresh={remote.reload}>
      <Footnote>
        A thread gets these as environment variables when it runs. A channel secret overrides a global one with the same name. Omni never shows a value again: to change one, save it again with the same name.
      </Footnote>
      {remote.data ? (
        groups.length ? (
          groups.map((g) => (
            <Group key={g.scope} title={label(g.scope)}>
              {g.rows.map((s, i) => (
                <ListRow
                  key={`${s.scope}/${s.name}`}
                  first={i === 0}
                  icon="key"
                  title={s.name}
                  detail={channelId && s.scope === GLOBAL_SCOPE ? 'Inherited from Global' : `Saved ${relTime(s.updated_at)}`}
                  onPress={() => open(s)}
                />
              ))}
            </Group>
          ))
        ) : (
          <Footnote>No secrets yet.</Footnote>
        )
      ) : (
        <Loading error={remote.error} retry={remote.reload} />
      )}
      <Group title="Add or replace">
        <ListRow first title="Scope" value={label(scope)} chevron onPress={() => setPicking(true)} />
        <InputRow label="Name" value={name} code placeholder="SHOPIFY_CLI_THEME_TOKEN" onChangeText={(t) => (setSaved(null), setName(t.toUpperCase()))} />
        <InputRow label="Value" value={value} code secure placeholder="Paste the value" onChangeText={(t) => (setSaved(null), setValue(t))} />
      </Group>
      <SaveRow label="Save secret" busy={busy} disabled={!name || !value} error={error} saved={false} onPress={() => void save()} />
      {saved ? <Footnote>{saved}</Footnote> : null}
      <Sheet visible={picking} title="Scope" onClose={() => setPicking(false)}>
        <ScrollView contentContainerStyle={styles.sheet}>
          <OptionGroup>
            {scopes.map((s, i) => {
              const c = channels?.find((x) => channelScope(x.id) === s);
              return (
                <OptionRow
                  key={s}
                  label={c ? channelTitle(c) : 'Global'}
                  sub={c ? undefined : 'All channels'}
                  selected={s === scope}
                  onPress={() => {
                    setScope(s);
                    setPicking(false);
                  }}
                  last={i === scopes.length - 1}
                />
              );
            })}
          </OptionGroup>
        </ScrollView>
      </Sheet>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingVertical: space.s6,
    paddingBottom: space.s11,
  },
});
