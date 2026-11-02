import { STATUS_LETTER } from '@omni/shared/changes-view.ts';
import type { DiffLine } from '@omni/shared/diff.ts';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DiffCount } from '../review/parts';
import { fontSize, minTarget, mono, space, useOmniTheme } from '../theme';
import { pickable, type ChangeRow } from './rows';

const DIGIT = 7.4;
const LINE_HEIGHT = 17;

const KIND_WORD = { add: 'Added', del: 'Removed', context: 'Unchanged', hunk: 'Hunk', note: 'Note' } as const;

interface LineRowProps {
  fileKey: string;
  index: number;
  line: DiffLine;
  width: number;
  picked: boolean;
  onPress: (fileKey: string, index: number) => void;
}

export const LineRow = memo(function LineRow({ fileKey, index, line, width, picked, onPress }: LineRowProps) {
  const { colors } = useOmniTheme();
  const canPick = pickable(line);
  const tint = picked ? colors.mark : line.kind === 'add' ? colors.diffAdd : line.kind === 'del' ? colors.diffDel : line.kind === 'hunk' ? colors.surface2 : 'transparent';
  const number = line.new ?? line.old;
  const body = (
    <View style={[styles.line, { backgroundColor: tint, borderLeftColor: picked ? colors.fg : 'transparent' }]}>
      <Text style={[styles.gutter, { width: width * DIGIT + space.s2, color: colors.fg4 }]}>{number ?? ''}</Text>
      <Text style={[styles.text, { color: line.kind === 'hunk' || line.kind === 'note' ? colors.fg3 : colors.fg }]}>{line.text || ' '}</Text>
    </View>
  );
  if (!canPick) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${KIND_WORD[line.kind]} line ${number ?? ''}: ${line.text.slice(1)}`}
      accessibilityHint={picked ? 'Tap again to pick up to this line' : 'Picks this line to send to the agent'}
      accessibilityState={{ selected: picked }}
      onPress={() => onPress(fileKey, index)}
    >
      {body}
    </Pressable>
  );
});

interface FileHeaderProps {
  row: Extract<ChangeRow, { type: 'file' }>;
  onToggle: (fileKey: string) => void;
}

export const FileHeader = memo(function FileHeader({ row, onToggle }: FileHeaderProps) {
  const { colors } = useOmniTheme();
  const { file, diff, label, key } = row.file;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${file.status.replace('_', ' ')}`}
      accessibilityHint={row.open ? 'Collapses the diff' : 'Expands the diff'}
      accessibilityState={{ expanded: row.open }}
      onPress={() => onToggle(key)}
      style={({ pressed }) => [styles.file, { backgroundColor: pressed ? colors.surface3 : colors.surface2, borderTopColor: colors.line }]}
    >
      <Text style={[styles.caret, { color: colors.fg3 }]}>{row.open ? '▾' : '▸'}</Text>
      <Text style={[styles.letter, { color: colors.fg3 }]}>{STATUS_LETTER[file.status]}</Text>
      <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.label, { color: colors.fg }]}>
        {label}
      </Text>
      {file.binary ? <Text style={[styles.meta, { color: colors.fg3 }]}>binary</Text> : <DiffCount add={diff.add} del={diff.del} />}
    </Pressable>
  );
});

export function GroupHeader({ title, count }: { title: string; count: number }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={[styles.groupTitle, { color: colors.fg3 }]}>
        {title}
      </Text>
      <Text style={[styles.meta, { color: colors.fg4 }]}>{count}</Text>
    </View>
  );
}

export function NoteRow({ text }: { text: string }) {
  const { colors } = useOmniTheme();
  return <Text style={[styles.note, { color: colors.fg3 }]}>{text}</Text>;
}

export function MoreRow({ fileKey, hidden, onShow }: { fileKey: string; hidden: number; onShow: (fileKey: string) => void }) {
  const { colors } = useOmniTheme();
  const label = `Show ${hidden} more ${hidden === 1 ? 'line' : 'lines'}`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onShow(fileKey)} style={styles.more}>
      <Text style={[styles.moreLabel, { color: colors.fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    borderLeftWidth: 3,
    paddingRight: space.s4,
  },
  gutter: {
    fontFamily: mono,
    fontSize: fontSize.meta,
    lineHeight: LINE_HEIGHT,
    textAlign: 'right',
    paddingRight: space.s2,
    marginLeft: space.s2,
    fontVariant: ['tabular-nums'],
  },
  text: {
    flex: 1,
    fontFamily: mono,
    fontSize: fontSize.meta + 1,
    lineHeight: LINE_HEIGHT,
  },
  file: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    paddingHorizontal: space.s6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  caret: {
    width: 12,
    fontSize: fontSize.body,
  },
  letter: {
    width: 14,
    fontFamily: mono,
    fontSize: fontSize.meta + 1,
  },
  label: {
    flex: 1,
    fontFamily: mono,
    fontSize: fontSize.meta + 1,
  },
  meta: {
    fontSize: fontSize.meta + 1,
    fontVariant: ['tabular-nums'],
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    paddingHorizontal: space.s8,
    paddingTop: space.s8,
    paddingBottom: space.s4,
  },
  groupTitle: {
    fontSize: fontSize.meta,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  note: {
    fontSize: fontSize.body,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
  },
  more: {
    minHeight: minTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
