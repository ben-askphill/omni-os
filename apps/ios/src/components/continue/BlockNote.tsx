import { closesTerminal } from '@omni/shared/continue-flow.ts';
import type { ContinueBlock } from '@omni/shared/continue.ts';
import { StyleSheet, View } from 'react-native';

import { space } from '../../theme';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';

interface BlockNoteProps {
  block: ContinueBlock;
  onRecheck: () => void;
  onCloseTerminal: () => void;
  closing: boolean;
}

/** Why the thread cannot be continued yet, with Check again, and Close terminal when an open shell is why. */
export function BlockNote({ block, onRecheck, onCloseTerminal, closing }: BlockNoteProps) {
  return (
    <Callout message={block.message}>
      <View style={styles.actions}>
        {closesTerminal(block) ? <Button label="Close terminal" busy={closing} onPress={onCloseTerminal} /> : null}
        <Button label="Check again" variant="secondary" disabled={closing} onPress={onRecheck} />
      </View>
    </Callout>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: space.s4,
  },
});
