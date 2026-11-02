import type { RunOnRow } from '@omni/shared/thread-machine.ts';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';

import { fontSize, space, useOmniTheme } from '../../theme';
import { Callout } from '../../ui/Callout';
import { OptionGroup, OptionRow } from '../../ui/OptionRow';
import { Sheet } from '../../ui/Sheet';

interface MachineListProps {
  rows: readonly RunOnRow[];
  /** The row with the radio. Empty: none is picked yet. */
  value: string;
  note: string;
  /** A request is out: the rows wait. */
  busy: boolean;
  error: string | null;
  onPick: (value: string) => void;
}

/**
 * The machine rows with the note and the error under them. A machine that cannot take the thread (Tailscale sees it
 * offline) is greyed out with why. Lay it out inside a column with a gap: the thread menu shows it as one of its pages
 * and `MachineSheet` as a sheet.
 */
export function MachineList({ rows, value, note, busy, error, onPick }: MachineListProps) {
  const { colors } = useOmniTheme();
  return (
    <>
      {error ? <Callout message={error} /> : null}
      <OptionGroup title="Machines">
        {rows.map((row, i) => (
          <OptionRow
            key={row.value}
            label={row.label}
            sub={row.sub}
            leading={<Text style={styles.glyph}>🖥</Text>}
            selected={row.value === value}
            disabled={row.disabled || busy}
            onPress={() => onPick(row.value)}
            last={i === rows.length - 1}
          />
        ))}
      </OptionGroup>
      <Text style={[styles.note, { color: colors.fg3 }]}>{note}</Text>
    </>
  );
}

/** The Spinner for the header's trailing slot, while a hand off is being sent. */
export function MachineSpinner() {
  const { colors } = useOmniTheme();
  return <ActivityIndicator accessibilityLabel="Sending" color={colors.fg3} />;
}

interface MachineSheetProps extends MachineListProps {
  visible: boolean;
  title?: string;
  onClose: () => void;
}

/** A sheet of machines to pick from, for a screen that is not a sheet itself (the new thread's Run on). */
export function MachineSheet({ visible, title = 'Run on', onClose, busy, ...list }: MachineSheetProps) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose} accessory={busy ? <MachineSpinner /> : null}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <MachineList busy={busy} {...list} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space.s8,
    paddingVertical: space.s6,
  },
  glyph: {
    fontSize: 18,
  },
  note: {
    paddingHorizontal: space.s9,
    fontSize: fontSize.body,
  },
});
