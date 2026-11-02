import { takeoverConfirm, type Takeover } from '@omni/shared/handoff.ts';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fontSize, lineHeight, space, useOmniTheme } from '../../theme';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Sheet } from '../../ui/Sheet';

interface TakeoverPromptProps {
  takeover: Takeover;
  busy: boolean;
  /** A refusal stays here, under the question, and the prompt stays open. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** What Take over asks before it goes ahead, in the words the web uses (`takeoverConfirm`): it cuts a turn on another machine. */
export function TakeoverPrompt({ takeover, busy, error, onConfirm, onCancel }: TakeoverPromptProps) {
  const { colors } = useOmniTheme();
  const { title, body } = takeoverConfirm(takeover);
  return (
    <View style={styles.prompt}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>
        {title}
      </Text>
      <Text style={[styles.body, { color: colors.fg3 }]}>{body}</Text>
      {error ? <Callout message={error} /> : null}
      <View style={styles.actions}>
        <Button label="Take over" busy={busy} onPress={onConfirm} />
        <Button label="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

interface TakeoverSheetProps extends Omit<TakeoverPromptProps, 'takeover'> {
  /** Null while there is nothing to take over, which closes the sheet. */
  takeover: Takeover | null;
  visible: boolean;
}

/** The Take over confirm as a sheet, for the banner's button. */
export function TakeoverSheet({ takeover, visible, onCancel, ...prompt }: TakeoverSheetProps) {
  return (
    <Sheet visible={visible && takeover !== null} title="Take over" onClose={onCancel}>
      <ScrollView keyboardShouldPersistTaps="handled">{takeover ? <TakeoverPrompt takeover={takeover} onCancel={onCancel} {...prompt} /> : null}</ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  prompt: {
    gap: space.s8,
    paddingHorizontal: space.s9,
    paddingVertical: space.s8,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '600',
    lineHeight: Math.round(fontSize.heading * lineHeight.heading),
  },
  body: {
    fontSize: fontSize.input,
    lineHeight: Math.round(fontSize.input * lineHeight.body),
  },
  actions: {
    gap: space.s6,
    paddingTop: space.s4,
  },
});
