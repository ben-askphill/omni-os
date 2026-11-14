import { autoAvatarColor, AVATAR_SWATCHES } from '@omni/shared/avatar-color.ts';
import type { Channel, HarnessInfo, OmniApi } from '@omni/client-core';
import { portLabel, SETUP_MODE_LABEL } from '@omni/shared/channel-actions.ts';
import { CHANNEL_GLYPHS, glyphIcon } from '@omni/shared/channel-icon.ts';
import { channelBody, channelForm, channelFormProblem, CHANNEL_KINDS, slugify, type ChannelForm, type ChannelKind } from '@omni/shared/channel-form.ts';
import { bytes } from '@omni/shared/format.ts';
import { PR_STEPS, STEP_LABEL, STEP_PROMPTS } from '@omni/shared/thread-glance.ts';
import { StackActions, useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ChannelAvatar } from '../components/ChannelAvatar';
import { HeaderButton } from '../components/HeaderButton';
import { RunOptions } from '../components/thread/RunOptions';
import { useChannels, useLiveHub } from '../live/react';
import { useRemote } from '../live/use-remote';
import type { RootScreenProps } from '../navigation/types';
import { draftSheetModel } from '../newthread/draft';
import { pickDesignSystem } from '../settings/design-system';
import { canArchive, channelTitle, formDirty, iconParts, lastEmoji, runFromPick, runLabel, saveBody, shownRun } from '../settings/channel-settings-model';
import { Footnote, Group, InputRow, SettingsPage, SwitchRow } from '../settings/parts';
import { fontSize, minTarget, space, useOmniTheme, weight } from '../theme';
import { Callout } from '../ui/Callout';
import { ListRow } from '../ui/GroupedList';
import { Icon, isIconName } from '../ui/Icon';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Sheet } from '../ui/Sheet';
import { Text } from '../ui/Text';

const loadHarnesses = (api: OmniApi) => api.harnesses();

/**
 * A channel's settings, the same fields the Web UI's channel settings edit, saved through PATCH /channels/:id so a
 * value set here shows on the computer and the other way round. Opened from a channel's header, a long press in
 * Channels, and Settings › Channels. Without an id it makes a new channel.
 */
export function ChannelSettingsScreen({ route, navigation }: RootScreenProps<'ChannelSettings'>) {
  const id = route.params?.id;
  const { channels } = useChannels();
  const channel = id ? (channels?.find((c) => c.id === id) ?? null) : null;
  if (id && !channel) return <Missing loading={channels === null} />;
  return <ChannelSettingsForm key={id ?? 'new'} channel={channel} navigation={navigation} />;
}

function Missing({ loading }: { loading: boolean }) {
  const { colors } = useOmniTheme();
  return (
    <SettingsPage>
      {loading ? <ActivityIndicator accessibilityLabel="Loading" color={colors.fg3} /> : <Callout message="This channel is gone or archived. Settings › Channels lists the archived ones." />}
    </SettingsPage>
  );
}

function ChannelSettingsForm({ channel, navigation }: { channel: Channel | null; navigation: RootScreenProps<'ChannelSettings'>['navigation'] }) {
  const hub = useLiveHub();
  const { colors } = useOmniTheme();
  const harnesses = useRemote(loadHarnesses);
  const [form, setForm] = useState<ChannelForm>(() => channelForm(channel ?? undefined));
  const [idTouched, setIdTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saved, setSaved] = useState(false);
  const isNew = channel === null;
  const system = channel?.kind === 'system';
  const dirty = channel ? formDirty(form, channel) : !!form.name.trim();

  // Another device saves the channel: follow it unless this form has edits of its own.
  const base = useRef(channel);
  useEffect(() => {
    if (!channel || channel === base.current) return;
    const prev = base.current;
    base.current = channel;
    setForm((cur) => (prev && !formDirty(cur, prev) ? channelForm(channel) : cur));
  }, [channel]);

  const set = <K extends keyof ChannelForm>(key: K, value: ChannelForm[K]) => {
    setSaved(false);
    setForm((cur) => ({ ...cur, [key]: value, ...(key === 'name' && isNew && !idTouched ? { id: slugify(String(value)) } : {}) }));
  };

  const save = useCallback(async () => {
    const problem = channelFormProblem(form, isNew);
    if (problem) return setError(problem);
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      if (channel) {
        const next = await hub.request((api) => api.updateChannel(channel.id, saveBody(form, channel)));
        base.current = next;
        setForm(channelForm(next));
        setSaved(true);
        await hub.refreshChannels();
      } else {
        const made = await hub.request((api) => api.createChannel(form.id, channelBody(form, { system: false, github: false })));
        await hub.refreshChannels();
        navigation.dispatch(StackActions.replace('Channel', { id: made.id }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }, [channel, form, hub, isNew, navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: channel ? channelTitle(channel) : 'New channel',
      headerRight: () =>
        busy ? <ActivityIndicator color={colors.fg3} /> : <HeaderButton label={isNew ? 'Create' : saved && !dirty ? 'Saved' : 'Save'} disabled={!dirty} onPress={() => void save()} />,
    });
  }, [navigation, channel, isNew, busy, dirty, saved, save, colors.fg3]);

  function confirmArchive() {
    if (!channel) return;
    Alert.alert(`Archive ${channelTitle(channel)}?`, 'Its threads stay. Settings › Channels lists it under Archived, with Unarchive.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: () =>
          void hub
            .request((api) => api.updateChannel(channel.id, { archived: 1 }))
            .then(() => hub.refreshChannels())
            .then(() => navigation.dispatch(StackActions.popToTop()))
            .catch((e: unknown) => Alert.alert("Couldn't archive the channel", e instanceof Error ? e.message : 'Something went wrong. Try again.')),
      },
    ]);
  }

  const hasRepo = !!form.repo_path.trim();
  return (
    <SettingsPage>
      <View style={styles.hero}>
        <ChannelAvatar name={form.name || form.id || '?'} icon={form.icon} avatarBg={form.avatar_bg} conductor={channel?.id === 'conductor'} size={56} />
        <Text style={[styles.heroName, { color: colors.fg }]} numberOfLines={1}>
          {form.name.trim() || 'New channel'}
        </Text>
      </View>
      {error ? <Callout message={error} /> : null}

      <Group title="Basics">
        <InputRow first label="Name" value={form.name} placeholder="Acme" autoCapitalize="words" onChangeText={(t) => set('name', t)} />
        {isNew ? (
          <InputRow
            label="Id"
            value={form.id}
            code
            placeholder="acme"
            hint="Used in links and by the Conductor. It cannot change later."
            onChangeText={(t) => {
              setIdTouched(true);
              set('id', t.toLowerCase());
            }}
          />
        ) : null}
        <ListRow
          title="Default model"
          detail="What a new thread here starts on. A thread or crew role that picks its own wins."
          value={runLabel(form.run, harnesses.data)}
          chevron
          onPress={() => setPicking(true)}
        />
      </Group>

      {!system ? (
        <View style={styles.block}>
          <SegmentedControl<ChannelKind> options={CHANNEL_KINDS.map((k) => ({ value: k.id, label: k.label }))} value={form.kind} onChange={(k) => set('kind', k)} />
          <Footnote>Client, internal or personal: how Channels groups it.</Footnote>
        </View>
      ) : null}

      <Group title="Avatar background">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16 }}>
          {AVATAR_SWATCHES.map((color) => <Pressable key={color} accessibilityRole="button" accessibilityLabel={`Use ${color}`} accessibilityState={{ selected: form.avatar_bg === color }} onPress={() => { set('avatar_bg', color); set('avatar_bg_manual', 1); }} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color, borderWidth: form.avatar_bg === color ? 2 : 0, borderColor: colors.fg }} />)}
        </View>
        <InputRow first label="Hex color" value={form.avatar_bg} placeholder="#e8d9f5" autoCapitalize="none" onChangeText={(v) => { set('avatar_bg', v); set('avatar_bg_manual', 1); }} />
        <ListRow title="Reset to auto" onPress={() => { set('avatar_bg', autoAvatarColor(form.icon) ?? ''); set('avatar_bg_manual', 0); }} />
      </Group>
      <IconPicker icon={form.icon} onChange={(v) => { set('icon', v); if (!form.avatar_bg_manual) set('avatar_bg', autoAvatarColor(v) ?? ''); }} />

      <Group footer="Added to every thread's system prompt in this channel. Keep it short: who the client is, conventions, what not to touch.">
        <InputRow first label="Notes" value={form.notes} multiline autoCapitalize="sentences" onChangeText={(t) => set('notes', t)} />
      </Group>

      {channel ? <DesignSystemGroup channel={channel} /> : null}

      <Group title="Branch steps" footer="What the Open PR, Fix conflicts and Fix checks buttons ask the agent in this channel. Empty uses the built-in prompt.">
        {PR_STEPS.map((step, i) => (
          <InputRow key={step} first={i === 0} label={STEP_LABEL[step]} value={form.prompts[step]} multiline autoCapitalize="sentences" placeholder={STEP_PROMPTS[step]} onChangeText={(t) => set('prompts', { ...form.prompts, [step]: t })} />
        ))}
      </Group>

      <Group title="Code" footer={hasRepo ? 'The repo is a path on the server’s machine, so it changes on that computer.' : 'No repo, so threads run in the base directory. Set a repo on the computer.'}>
        <InputRow first label="Repo path" value={form.repo_path} code readOnly placeholder="No repo" />
        {hasRepo ? (
          <InputRow label="GitHub repo" value={form.github_repo} code placeholder="acme/acme-theme" hint="owner/name. Read from the repo path when empty." onChangeText={(t) => set('github_repo', t)} />
        ) : (
          <InputRow label="Base directory" value={form.base_dir} code readOnly placeholder="Your workspace folder" />
        )}
        <SwitchRow title="Worktree per thread" detail="Each thread gets its own branch (omni/…), so parallel work never collides. Off runs in the repo itself." value={form.use_worktree} disabled={!hasRepo} onValueChange={(v) => set('use_worktree', v)} />
        <SwitchRow title="Show the browser window" detail="Off runs the channel browser headless. On, to watch it or log in by hand. Logins stay per channel." value={form.showBrowser} onValueChange={(v) => set('showBrowser', v)} />
      </Group>

      <Group title="Store">
        <InputRow first label="Store domain" value={form.store_domain} code keyboardType="url" placeholder="acme.myshopify.com" onChangeText={(t) => set('store_domain', t)} />
        <InputRow label="Portal slug" value={form.portal_slug} code placeholder="acme" hint="Ask Phill Portal company slug, for client context." onChangeText={(t) => set('portal_slug', t)} />
      </Group>

      {channel ? <ActionsGroup channel={channel} navigation={navigation} /> : null}

      {channel ? (
        <Group title="Secrets" footer="API keys and tokens this channel's threads get. A channel secret overrides a global one.">
          <ListRow first icon="key" title="Channel secrets" chevron onPress={() => navigation.navigate('Secrets', { channel: channel.id })} />
        </Group>
      ) : null}

      {channel && canArchive(channel) ? (
        <Group>
          <ListRow first icon="archive" tone="destructive" title="Archive channel" onPress={confirmArchive} />
        </Group>
      ) : null}

      <Sheet visible={picking} title="Default model" onClose={() => setPicking(false)}>
        <ScrollView contentContainerStyle={styles.sheet}>
          {harnesses.data ? <RunPicker run={form.run} harnesses={harnesses.data} onChange={(run) => set('run', run)} /> : <ActivityIndicator color={colors.fg3} />}
          {harnesses.error && !harnesses.data ? <Callout message={harnesses.error} /> : null}
        </ScrollView>
      </Sheet>
    </SettingsPage>
  );
}

function RunPicker({ run, harnesses, onChange }: { run: ChannelForm['run']; harnesses: HarnessInfo[]; onChange: (run: ChannelForm['run']) => void }) {
  const sheet = draftSheetModel(shownRun(run, harnesses), harnesses);
  return (
    <RunOptions
      model={sheet}
      disabled={false}
      auto={{ selected: sheet.auto, onPress: () => onChange(runFromPick(run, harnesses, 'auto')) }}
      onEffort={(effort) => onChange(runFromPick(run, harnesses, { effort }))}
      onModel={(harness, model) => onChange(runFromPick(run, harnesses, { harness, model }))}
    />
  );
}

/** Emoji, one of the design system's icons, or the first letter. An uploaded SVG comes from the computer and shows here with Clear. */
function IconPicker({ icon, onChange }: { icon: string; onChange: (value: string) => void }) {
  const { colors } = useOmniTheme();
  const parts = iconParts(icon);
  return (
    <Group title="Icon" footer="Shown in Channels and on the channel. Empty uses the first letter.">
      <InputRow first label="Emoji" value={parts.kind === 'emoji' ? parts.text : ''} placeholder="Type one emoji" onChangeText={(t) => onChange(lastEmoji(t))} />
      {parts.kind === 'svg' ? <ListRow title="Custom SVG" detail="Uploaded on the computer" /> : null}
      <View style={[styles.glyphs, { borderTopColor: colors.line }]} accessibilityRole="radiogroup" accessibilityLabel="Icon">
        {CHANNEL_GLYPHS.filter(isIconName).map((g) => {
          const on = parts.kind === 'glyph' && parts.name === g;
          return (
            <Pressable
              key={g}
              accessibilityRole="radio"
              accessibilityLabel={g}
              accessibilityState={{ selected: on }}
              onPress={() => onChange(on ? '' : glyphIcon(g))}
              style={[styles.glyph, { backgroundColor: on ? colors.fg : colors.surface2 }]}
            >
              <Icon name={g} size={17} color={on ? colors.onInk : colors.fg2} />
            </Pressable>
          );
        })}
      </View>
      {icon ? <ListRow title="Clear icon" icon="close" onPress={() => onChange('')} /> : null}
    </Group>
  );
}

/** Saved at once, not with Save: the file is too big to hold in the form. */
function DesignSystemGroup({ channel }: { channel: Channel }) {
  const hub = useLiveHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: (api: OmniApi) => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await hub.request(call);
      await hub.refreshChannels();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    try {
      const file = await pickDesignSystem();
      if (file) await run((api) => api.setDesignSystem(channel.id, file.name, file.html));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    }
  }

  return (
    <Group
      title="Design system"
      footer={
        error ??
        'One standalone HTML file with your tokens, type and components. Threads here read it before they write an HTML page. Saved as soon as you pick it.'
      }
    >
      {channel.design_system_name ? <ListRow first icon="file" title={channel.design_system_name} value={bytes(channel.design_system_size)} /> : null}
      <ListRow first={!channel.design_system_name} icon="doc" title={channel.design_system_name ? 'Replace file' : 'Upload HTML file'} disabled={busy} onPress={() => void upload()} />
      {channel.design_system_name ? (
        <ListRow icon="trash" title="Remove" disabled={busy} onPress={() => void run((api) => api.removeDesignSystem(channel.id))} />
      ) : null}
    </Group>
  );
}

const loadActions = (channelId: string) => (api: OmniApi) => api.channelActions(channelId);

/** The channel's named actions. Each one saves on its own, as on the Web UI. */
function ActionsGroup({ channel, navigation }: { channel: Channel; navigation: RootScreenProps<'ChannelSettings'>['navigation'] }) {
  const load = useMemo(() => loadActions(channel.id), [channel.id]);
  const actions = useRemote(load);
  const { reload } = actions;
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  const list = actions.data ?? [];
  return (
    <Group title="Actions" footer={actions.error && !actions.data ? actions.error : "Commands a thread here runs from its Actions screen, like a theme preview or the tests."}>
      {list.map((a, i) => (
        <ListRow
          key={a.id}
          first={i === 0}
          icon="play"
          title={a.name}
          detail={[a.command.split('\n')[0], portLabel(a.port), a.setup && SETUP_MODE_LABEL[a.setup]].filter(Boolean).join(' · ')}
          chevron
          onPress={() => navigation.navigate('ChannelAction', { channel: channel.id, action: a })}
        />
      ))}
      <ListRow first={list.length === 0} icon="plus" title="Add action" onPress={() => navigation.navigate('ChannelAction', { channel: channel.id })} />
    </Group>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: space.s4,
    paddingVertical: space.s6,
  },
  heroName: {
    fontSize: fontSize.heading,
    fontWeight: weight.semibold,
  },
  block: {
    gap: space.s2,
  },
  glyphs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.s4,
    padding: space.s8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  glyph: {
    width: minTarget - 4,
    height: minTarget - 4,
    borderRadius: (minTarget - 4) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    gap: space.s8,
    paddingVertical: space.s6,
    paddingBottom: space.s11,
  },
});
