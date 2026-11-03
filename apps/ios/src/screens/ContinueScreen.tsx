import type { HarnessInfo } from '@omni/client-core';
import {
  blockOf,
  canStart,
  continueTargets,
  refusalText,
  shownPreview,
  sizeLine,
  slashHint,
  workspaceText,
  type ContinueSource,
} from '@omni/shared/continue-flow.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/Text';

import { HeaderButton } from '../components/HeaderButton';
import { Notice } from '../components/Notice';
import { AttachmentList } from '../components/continue/AttachmentList';
import { BlockNote } from '../components/continue/BlockNote';
import { CarryoverSections, ExactText } from '../components/continue/CarryoverSections';
import { RunOptions } from '../components/thread/RunOptions';
import { pickerModel, runFor, runLabel } from '../continue/flow';
import { useContinue, useContinueSource } from '../continue/hooks';
import { useLiveHub } from '../live/react';
import type { RootScreenProps } from '../navigation/types';
import { fontSize, lineHeight, radius, space, useOmniTheme, weight } from '../theme';
import { useHarnessCatalog } from '../thread/hooks';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { OptionGroup, OptionRow } from '../ui/OptionRow';
import { Sheet } from '../ui/Sheet';

const TITLE = 'Continue with another harness';

/**
 * Fork a thread onto another local harness: pick the run, read what the new thread will be given, write its first
 * message. Mirrors the phone web's ContinueSheet (apps/web/src/mobile/ContinueSheet.tsx). Start opens the new, linked
 * thread in place of this screen.
 */
export function ContinueScreen({ route, navigation }: RootScreenProps<'Continue'>) {
  const { id } = route.params;
  const { state, reload } = useContinueSource(id);
  const source = state.status === 'ready' ? state.source : null;
  const catalog = useHarnessCatalog(source?.channel_id, source !== null);

  useEffect(() => {
    navigation.setOptions({ title: TITLE, headerLeft: () => <HeaderButton label="Cancel" onPress={() => navigation.goBack()} /> });
  }, [navigation]);

  if (state.status === 'failed') return <Notice title="Could not open this thread" body={state.error} action={{ label: 'Try again', onPress: reload }} />;
  if (!source) return <Notice title="Loading" />;
  if (!catalog.harnesses) {
    return catalog.error ? (
      <Notice title="Could not load the harnesses" body={catalog.error} action={{ label: 'Try again', onPress: catalog.reload }} />
    ) : (
      <Notice title="Loading harnesses" />
    );
  }
  return <ContinueForm source={source} harnesses={catalog.harnesses} reloadHarnesses={catalog.reload} navigation={navigation} />;
}

function ContinueForm({
  source,
  harnesses,
  reloadHarnesses,
  navigation,
}: {
  source: ContinueSource;
  harnesses: HarnessInfo[];
  reloadHarnesses: () => void;
  navigation: RootScreenProps<'Continue'>['navigation'];
}) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const targets = useMemo(() => continueTargets(harnesses), [harnesses]);
  const { s, dispatch, start, recheck, closeTerminal, closing } = useContinue(source, targets.offered);
  const [picking, setPicking] = useState(false);
  const { run } = s;
  const p = shownPreview(s.preview);
  const block = blockOf(s);
  const note = refusalText(s.refusal);
  const hint = slashHint(s.text);
  const loading = s.preview.kind === 'loading';
  const label = run ? runLabel(run, targets.offered) : null;
  const picker = pickerModel(run, targets.offered);
  const startable = canStart(s);

  const submit = async () => {
    const thread = await start();
    if (!thread) return;
    hub.applyThread(thread);
    navigation.replace('Thread', { id: thread.id });
  };
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => <HeaderButton label={s.posting ? 'Starting' : 'Start'} disabled={!startable} onPress={() => void submitRef.current()} />,
    });
  }, [navigation, startable, s.posting]);

  return (
    <>
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={[styles.intro, { color: colors.fg3 }]}>
          A new thread picks up <Text style={{ color: colors.fg }}>{source.title || 'this thread'}</Text> on the harness you pick, with its own branch and session. The two threads link to each other.
        </Text>

        <OptionGroup title="Continue on">
          <OptionRow
            label={label?.title ?? 'Pick a model'}
            sub={label?.harness ?? 'No local harness is ready'}
            opens
            disabled={s.posting || !picker}
            onPress={() => {
              reloadHarnesses();
              setPicking(true);
            }}
            last
          />
        </OptionGroup>
        {!run ? <Text style={[styles.note, { color: colors.fg3 }]}>No local harness is ready. The list says how to set one up.</Text> : null}
        {targets.refused.map((r) => (
          <Text key={r.id} style={[styles.note, { color: colors.fg3 }]}>
            {r.reason}
          </Text>
        ))}

        {p && p.carryover.attachments.length > 0 ? <AttachmentList files={p.carryover} disabled={s.posting} onToggle={(attachment) => dispatch({ type: 'attach', id: attachment })} /> : null}

        <TextInput
          multiline
          value={s.text}
          onChangeText={(text) => dispatch({ type: 'text', text })}
          editable={!s.posting}
          accessibilityLabel="Your message"
          placeholder="What should it do next? It reads this after the carryover."
          placeholderTextColor={colors.fg4}
          style={[styles.input, { color: colors.fg, backgroundColor: colors.surface }]}
          textAlignVertical="top"
        />
        {hint ? <Text style={[styles.note, { color: colors.fg3 }]}>{hint}</Text> : null}
        {block ? (
          <View style={styles.pad}>
            <BlockNote block={block} onRecheck={recheck} onCloseTerminal={() => void closeTerminal()} closing={closing} />
          </View>
        ) : null}
        {note ? (
          <View style={styles.pad}>
            <Callout message={note} />
          </View>
        ) : null}

        {run ? (
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={[styles.headingTitle, { color: colors.fg3 }]}>
              CARRYOVER
            </Text>
            {p ? <Text style={[styles.headingTitle, { color: colors.fg4 }]}>{sizeLine(p.carryover)}</Text> : null}
          </View>
        ) : null}
        {run && s.preview.kind === 'failed' ? (
          <View style={styles.pad}>
            <Callout message={s.preview.error}>
              <Button label="Retry" variant="secondary" onPress={recheck} />
            </Callout>
          </View>
        ) : run ? (
          <View style={styles.status}>
            {loading && !p ? <ActivityIndicator color={colors.fg3} /> : null}
            <Text style={[styles.note, styles.flex, { color: colors.fg3 }]}>{p ? workspaceText(p) : 'Building the preview'}</Text>
          </View>
        ) : null}
        {run && p ? (
          <View accessibilityState={{ busy: loading }} style={[styles.sections, { opacity: loading ? 0.5 : 1 }]}>
            <CarryoverSections carryover={p.carryover} />
            <ExactText text={p.carryover.text} />
          </View>
        ) : null}
      </ScrollView>

      <Sheet visible={picking} title="Continue on" onClose={() => setPicking(false)}>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          {picker ? (
            <RunOptions
              model={picker}
              disabled={s.posting}
              onEffort={(effort) => {
                const next = runFor(run, { effort });
                if (next) dispatch({ type: 'pick', run: next });
              }}
              onModel={(harness, model) => {
                const next = runFor(run, { harness, model });
                if (next) dispatch({ type: 'pick', run: next });
              }}
            />
          ) : null}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space.s8,
    paddingVertical: space.s6,
  },
  intro: {
    paddingHorizontal: space.s9,
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  note: {
    paddingHorizontal: space.s9,
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  flex: {
    flex: 1,
    paddingHorizontal: 0,
  },
  pad: {
    paddingHorizontal: space.s8,
  },
  input: {
    minHeight: 120,
    marginHorizontal: space.s8,
    borderRadius: radius.md,
    padding: space.s8,
    fontSize: fontSize.input,
    lineHeight: Math.round(fontSize.input * lineHeight.body),
  },
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.s9,
  },
  headingTitle: {
    fontSize: fontSize.meta,
    fontWeight: weight.semibold,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    paddingHorizontal: space.s9,
  },
  sections: {
    gap: space.s8,
  },
  sheetContent: {
    gap: space.s8,
    paddingVertical: space.s6,
  },
});
