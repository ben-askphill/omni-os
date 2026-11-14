import { HarnessLogo } from '../../ui/Brand';
import type { OmniApi } from '@omni/client-core';
import { channelForm } from '@omni/shared/channel-form.ts';
import { setsRun } from '@omni/shared/draft-run.ts';
import { HERE, runOnRows } from '@omni/shared/thread-machine.ts';
import { HARNESS } from '@omni/shared/brand.ts';
import { relTime } from '@omni/shared/format.ts';
import { accountDetail, accountLine, accountNotices, accountTone, switchLine } from '@omni/shared/harness-accounts.ts';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { StatusDot } from '../../components/StatusDot';
import { useChannels, useLiveHub } from '../../live/react';
import { useRemote } from '../../live/use-remote';
import type { RootStackParamList } from '../../navigation/types';
import { fontSize, lineHeight, mono, space, useOmniTheme } from '../../theme';
import { Callout } from '../../ui/Callout';
import { ListRow } from '../../ui/GroupedList';
import { Text } from '../../ui/Text';
import { channelTitle, runLabel } from '../channel-settings-model';
import { harnessRows } from '../harness-model';
import { ConfigForm } from '../ConfigForm';
import { ChoiceRow, Footnote, Group, ServerOptionsGroup, SettingsPage } from '../parts';
import { Loading, useSetup } from './OmniSections';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const loadHarnesses = (api: OmniApi) => api.harnesses();
const loadDevices = (api: OmniApi) => api.devices();
const loadStatus = (api: OmniApi) => api.status();
const loadAccounts = (api: OmniApi) => api.accounts();

/** Harnesses & models: whether each harness can run, Hermes, each channel's default model, and the .env options behind them. */
export function ModelsSection() {
  const { colors } = useOmniTheme();
  const navigation = useNavigation<Nav>();
  const setup = useSetup();
  const harnesses = useRemote(loadHarnesses);
  const { channels } = useChannels();
  const listed = (channels ?? []).filter((c) => !c.archived);
  const own = listed.filter((c) => setsRun(channelForm(c).run)).length;
  return (
    <SettingsPage onRefresh={() => Promise.all([harnesses.reload(), setup.reload()])}>
      {harnesses.data ? (
        <Group title="Harnesses" footer="The agents Omni can start a thread on. Install and log in on the server's machine.">
          {harnessRows(harnesses.data).map((h, i) => (
            <View key={h.id} style={[styles.harness, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <View style={styles.head}>
                <HarnessLogo harness={h.id} />
                <Text style={[styles.name, { color: colors.fg }]}>{h.name}</Text>
                <StatusDot glyph={h.ready ? 'done' : 'needs'} size={7} />
                <Text style={[styles.meta, { color: colors.fg3 }]}>{h.ready ? 'Ready' : 'Not ready'}</Text>
              </View>
              <Text style={[styles.meta, { color: colors.fg3 }]}>{h.detail}</Text>
              {h.fix ? <Text style={[styles.fix, { color: colors.fg2 }]}>To fix: {h.fix}</Text> : null}
            </View>
          ))}
        </Group>
      ) : (
        <Loading error={harnesses.error} retry={harnesses.reload} />
      )}
      {setup.data ? <ConfigForm page="models" state={setup.data} onSaved={setup.setData} footer="HERMES_API_KEY is under Secrets." /> : <Loading error={setup.error} retry={setup.reload} />}
      <Group
        title="Default model for new threads"
        footer={`Without one, Auto picks from the prompt. A thread or crew role that picks its own wins. ${own ? `${own} of ${listed.length} channels set one.` : 'Auto everywhere.'}`}
      >
        {listed.map((c, i) => (
          <ListRow key={c.id} first={i === 0} title={channelTitle(c)} value={runLabel(channelForm(c).run, harnesses.data)} chevron onPress={() => navigation.navigate('ChannelSettings', { id: c.id })} />
        ))}
      </Group>
      <ServerOptionsGroup section="models" />
    </SettingsPage>
  );
}

/** Threads: where new threads run, then the session and usage-limit options from .env, then Automations. */
export function ThreadsSection() {
  const navigation = useNavigation<Nav>();
  const hub = useLiveHub();
  const setup = useSetup();
  const devices = useRemote(loadDevices);
  const status = useRemote(loadStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => runOnRows(devices.data ?? [], { asDefault: true, hereName: status.data?.device?.name }), [devices.data, status.data]);
  const saved = setup.data?.config.runOn.device || HERE;

  async function pick(value: string) {
    if (value === saved || busy) return;
    setBusy(true);
    setError(null);
    try {
      setup.setData(await hub.request((api) => api.updateSetup({ runOn: { device: value === HERE ? '' : value } })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage onRefresh={() => Promise.all([setup.reload(), devices.reload()])}>
      {setup.data ? (
        <View style={styles.block}>
          <Group title="Run new threads on">
            {rows.map((r, i) => (
              <ChoiceRow key={r.value} first={i === 0} title={r.label} detail={r.sub} selected={r.value === saved} disabled={busy} onPress={() => void pick(r.value)} />
            ))}
          </Group>
          <Footnote>
            {rows.length > 1
              ? 'Unless New picks another machine. Saved on the server, so the computer and the phone start threads in the same place.'
              : 'Only this machine for now. Turn on Sync on the computer to start threads on another one.'}
          </Footnote>
          {error ? <Callout message={error} /> : null}
        </View>
      ) : (
        <Loading error={setup.error} retry={setup.reload} />
      )}
      <ServerOptionsGroup section="threads" title="Sessions, usage limits and thread features" />
      <Group footer="Threads that start on a schedule, a GitHub event or a webhook.">
        <ListRow first icon="automation" title="Automations" chevron onPress={() => navigation.navigate('Automations')} />
      </Group>
    </SettingsPage>
  );
}

/** Accounts: who each harness is signed in as on each machine, and the switches no one has acknowledged yet. */
export function AccountsSection() {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const accounts = useRemote(loadAccounts);
  const [error, setError] = useState<string | null>(null);
  const label = (h: string) => HARNESS[h]?.label ?? h;
  const refresh = async () => {
    try {
      accounts.setData(await hub.request((api) => api.accounts(true)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check again.');
    }
  };
  const ack = async (machine: string, harness: string) => {
    setError(null);
    try {
      accounts.setData(await hub.request((api) => api.acknowledgeAccountSwitch(machine, harness)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not acknowledge it.');
    }
  };
  const view = accounts.data;
  return (
    <SettingsPage onRefresh={refresh}>
      {error ? <Callout message={error} /> : null}
      {view ? (
        <>
          {accountNotices(view).map(({ machine, account }) => (
            <Callout key={`${machine.id}:${account.harness}`} message={switchLine(machine.name, label(account.harness), account)}>
              <ListRow first title="Got it" onPress={() => void ack(machine.id, account.harness)} />
            </Callout>
          ))}
          {view.machines.map((m) => (
            <Group key={m.id} title={m.current ? `${m.name} (this machine)` : m.name} footer={m.checkedAt ? `Checked ${relTime(m.checkedAt)}` : null}>
              {m.accounts.map((a, i) => {
                const detail = accountDetail(a);
                return (
                  <View key={a.harness} style={[styles.harness, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                    <View style={styles.head}>
                      <HarnessLogo harness={a.harness} />
                      <Text style={[styles.name, { color: colors.fg }]}>{label(a.harness)}</Text>
                      <StatusDot glyph={a.notice ? 'needs' : accountTone(a)} size={7} />
                    </View>
                    <Text style={[styles.meta, { color: a.state === 'signed-in' ? colors.fg : colors.fg3 }]}>{accountLine(a)}</Text>
                    {detail ? <Text style={[styles.meta, { color: colors.fg3 }]}>{detail}</Text> : null}
                  </View>
                );
              })}
            </Group>
          ))}
          <Footnote>
            {view.synced
              ? 'Each machine reads its own harnesses and syncs them. Pull to check this machine again.'
              : 'Only this machine is listed. Sync your other machines with it and each lists its own accounts here.'}
          </Footnote>
        </>
      ) : (
        <Loading error={accounts.error} retry={accounts.reload} />
      )}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space.s2,
  },
  harness: {
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
    gap: space.s1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
  },
  name: {
    fontSize: fontSize.subhead,
    marginRight: space.s2,
  },
  meta: {
    fontSize: fontSize.small,
    lineHeight: Math.round(fontSize.small * lineHeight.body),
  },
  fix: {
    fontFamily: mono,
    fontSize: fontSize.meta,
    lineHeight: Math.round(fontSize.meta * 1.5),
    fontWeight: '400',
  },
});
