import { useEffect, useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import { fontSize, space, useOmniTheme } from '../../theme';
import { useRunSwitch, type HarnessCatalog } from '../../thread/hooks';
import { runSheetModel, type RunThread } from '../../thread/run-model';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Sheet } from '../../ui/Sheet';
import { RunOptions } from './RunOptions';

interface RunSheetProps {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  /** Null until the thread has loaded. */
  thread: RunThread | null;
  busy: boolean;
  catalog: HarnessCatalog;
}

/**
 * The model, effort and harness switch. Its rows come from `/harnesses`, so a harness the server adds shows up here
 * without code. Between turns a pick applies at once. During a turn the server queues it, the check moves to the queued
 * run and the Next turn chip names it.
 */
export function RunSheet({ visible, onClose, threadId, thread, busy, catalog }: RunSheetProps) {
  const { colors } = useOmniTheme();
  const { state, pick, dismiss } = useRunSwitch(threadId, thread, catalog.harnesses);
  const model = useMemo(() => (thread && catalog.harnesses ? runSheetModel(thread, catalog.harnesses) : null), [thread, catalog.harnesses]);
  const switching = state.status === 'switching';

  useEffect(() => {
    if (!visible) dismiss();
  }, [visible, dismiss]);

  return (
    <Sheet visible={visible} title="Model" onClose={onClose} accessory={switching ? <ActivityIndicator color={colors.fg3} /> : null}>
      <ScrollView contentContainerStyle={styles.content}>
        {busy ? (
          <Text style={[styles.note, { color: colors.fg3 }]}>This thread is mid-turn. A switch waits for the turn to end and applies to the next one.</Text>
        ) : null}
        {state.status === 'failed' ? <Callout message={state.error} /> : null}
        {catalog.error && !model ? (
          <Callout message={catalog.error}>
            <Button label="Try again" onPress={catalog.reload} />
          </Callout>
        ) : null}
        {!model && !catalog.error ? <ActivityIndicator color={colors.fg3} style={styles.loading} /> : null}
        {model ? (
          <RunOptions
            model={model}
            disabled={switching}
            onEffort={(effort) => void pick({ effort })}
            onModel={(harness, id) => void pick({ harness, model: id })}
          />
        ) : null}
        <View style={styles.end} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space.s8,
    paddingVertical: space.s6,
  },
  note: {
    paddingHorizontal: space.s9,
    fontSize: fontSize.body,
  },
  loading: {
    paddingTop: space.s10,
  },
  end: {
    height: space.s10,
  },
});
