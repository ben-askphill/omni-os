import type { PickedLines } from '@omni/shared/diff-pick.ts';
import { diffSelection, selectRows } from '@omni/shared/message-context-diff.ts';
import { NOTE_MAX, newContext } from '@omni/shared/message-context.ts';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addDraftContext } from '../context/draft';
import { Button } from '../ui/Button';
import { fontSize, lineHeight, mono, radius, space, useOmniTheme } from '../theme';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The commits or snapshots a diff compares. A branch diff takes its group from the picked file; a turn's is always `turn`. */
export interface PickSource {
  from: string;
  to: string;
  turn: string | null;
}

interface SelectionDockProps {
  threadId: string;
  picked: PickedLines;
  source: PickSource;
  onClear: () => void;
  /** The lines are on the thread's next message. */
  onAdded: () => void;
}

export function SelectionDock({ threadId, picked, source, onClear, onAdded }: SelectionDockProps) {
  const { colors } = useOmniTheme();
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const body = useMemo(() => selectRows(picked.file, picked.from, picked.to, { ...source, group: source.turn ? 'turn' : picked.group }), [picked, source]);
  const name = body.ok ? diffSelection.label({ ...body.value, path: body.value.path.split('/').pop() ?? body.value.path }) : null;

  const add = () => {
    if (!body.ok) return;
    const why = addDraftContext(threadId, newContext(diffSelection, body.value, note));
    if (why) return setError(why);
    onAdded();
  };

  return (
    <View accessibilityLabel="Selected lines" style={[styles.dock, { backgroundColor: colors.bg, borderTopColor: colors.line, paddingBottom: Math.max(insets.bottom, space.s4) }]}>
      <View style={styles.what}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.name, { color: colors.fg2 }]}>
          {name ?? 'No lines'}
        </Text>
        {body.ok ? <Text style={[styles.count, { color: colors.fg3 }]}>{plural(body.value.rows.length, 'line')}</Text> : null}
      </View>
      <TextInput
        accessibilityLabel="Note for the agent"
        multiline
        maxLength={NOTE_MAX}
        value={note}
        onChangeText={(t) => {
          setNote(t);
          setError(null);
        }}
        placeholder="Add a note (optional)"
        placeholderTextColor={colors.fg3}
        style={[styles.note, { color: colors.fg, backgroundColor: colors.surface }]}
      />
      {error || !body.ok ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.needs }]}>{error ?? (!body.ok && body.error)}</Text> : null}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button variant="secondary" label="Cancel" onPress={onClear} />
        </View>
        <View style={styles.action}>
          <Button label="Add to message" disabled={!body.ok} onPress={add} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    gap: space.s4,
    paddingHorizontal: space.s8,
    paddingTop: space.s6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  what: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  name: {
    flex: 1,
    fontFamily: mono,
    fontSize: fontSize.meta + 1,
  },
  count: {
    fontSize: fontSize.meta + 1,
    fontVariant: ['tabular-nums'],
  },
  note: {
    minHeight: 56,
    maxHeight: 112,
    borderRadius: radius.md,
    paddingHorizontal: space.s6,
    paddingTop: space.s4,
    paddingBottom: space.s4,
    fontSize: fontSize.input,
    lineHeight: Math.round(fontSize.input * lineHeight.body),
    textAlignVertical: 'top',
  },
  error: {
    fontSize: fontSize.meta + 1,
  },
  actions: {
    flexDirection: 'row',
    gap: space.s4,
  },
  action: {
    flex: 1,
  },
});
