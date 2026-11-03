import { attachmentRows, attachmentsSummary } from '@omni/shared/continue-flow.ts';
import type { Carryover } from '@omni/shared/continue.ts';
import { StyleSheet, Switch, View } from 'react-native';
import { Text } from '../../ui/Text';

import { fontSize, lineHeight, space, useOmniTheme } from '../../theme';
import { OptionGroup } from '../../ui/OptionRow';
import { Tag } from './Tag';

interface AttachmentListProps {
  files: Pick<Carryover, 'attachments'>;
  disabled: boolean;
  onToggle: (id: string) => void;
}

/** The source's attachments, each with a switch. A file that cannot be carried says why and its switch stays off. */
export function AttachmentList({ files, disabled, onToggle }: AttachmentListProps) {
  const { colors } = useOmniTheme();
  const rows = attachmentRows(files);
  return (
    <>
      <OptionGroup title="Attachments">
        {rows.map((r, i) => (
          <View key={r.id} style={[styles.row, i < rows.length - 1 && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.text}>
              <View style={styles.name}>
                <Text numberOfLines={1} style={[styles.label, { color: r.selectable ? colors.fg : colors.fg3 }]}>
                  {r.name}
                </Text>
                {r.tag ? <Tag label={r.tag} /> : null}
              </View>
              <Text style={[styles.sub, { color: colors.fg3 }]}>{r.meta}</Text>
              {r.note ? <Text style={[styles.sub, { color: colors.fg3 }]}>{r.note}</Text> : null}
            </View>
            <Switch
              value={r.selected}
              disabled={disabled || !r.selectable}
              accessibilityLabel={`Carry ${r.name}`}
              onValueChange={() => onToggle(r.id)}
            />
          </View>
        ))}
      </OptionGroup>
      <Text style={[styles.summary, { color: colors.fg3 }]}>{attachmentsSummary(files)}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  label: {
    flexShrink: 1,
    fontSize: fontSize.input,
  },
  sub: {
    fontSize: fontSize.meta + 1,
    lineHeight: Math.round((fontSize.meta + 1) * lineHeight.body),
  },
  summary: {
    paddingHorizontal: space.s9,
    fontSize: fontSize.body,
  },
});
