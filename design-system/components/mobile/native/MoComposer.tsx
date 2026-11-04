import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoActionChip, MoRoundButton, type MoAction } from './MoButtons';
import { phone, type, useOmniTheme } from './theme';

/**
 * Composer pinned above the keyboard (wrap the screen in KeyboardAvoidingView or react-native-keyboard-controller):
 * action chips for this thread, then one line with + (attach, model, effort), the field, and mic until there is text,
 * then send. Stop replaces mic while a turn runs and the box is empty. children sit between chips and box
 * (attachment and context chips). The placeholder names who you are talking to: "Steer the builder", "Follow up".
 */
export function MoComposer({ placeholder = 'Message', value, onChangeText, actions = [], onSend, onPlus, onStop, onDictate, children, sendLabel = 'Send' }: {
  placeholder?: string; value?: string; onChangeText?: (v: string) => void; actions?: MoAction[]; onSend?: (text: string) => void;
  onPlus?: () => void; onStop?: () => void; onDictate?: () => void; children?: ReactNode; sendLabel?: string;
}) {
  const { colors } = useOmniTheme();
  const insets = useSafeAreaInsets();
  const [own, setOwn] = useState('');
  const v = value ?? own;
  const set = onChangeText ?? setOwn;
  const send = () => {
    const t = v.trim();
    if (!t) return;
    onSend?.(t);
    if (value == null) setOwn('');
  };
  return (
    <View style={{ paddingTop: 6, paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 12), backgroundColor: colors.bg }}>
      {actions.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {actions.map((a) => <MoActionChip key={a.label} {...a} />)}
        </ScrollView>
      )}
      {children}
      <View style={[styles.box, { backgroundColor: colors.surface }]}>
        <MoRoundButton icon="plus" label="Attach, model and effort" onPress={onPlus} />
        <TextInput value={v} onChangeText={set} placeholder={placeholder} placeholderTextColor={colors.fg3} multiline
          style={[type.input, styles.input, { color: colors.fg }]} />
        {v.trim() ? <MoRoundButton tone="ink" icon="send" label={sendLabel} onPress={send} />
          : onStop ? <MoRoundButton tone="ink" icon="stop" label="Stop" onPress={onStop} />
          : <MoRoundButton tone="quiet" icon="mic" label="Dictate" onPress={onDictate} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingTop: 2, paddingBottom: 10 },
  box: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, minHeight: phone.composerH, padding: 6, borderRadius: phone.composerRadius },
  input: { flex: 1, minHeight: 40, maxHeight: 140, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 10 },
});
