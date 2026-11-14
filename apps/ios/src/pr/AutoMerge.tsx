import { AUTO_MERGE_COPY, autoMergeView, type AutoMergeRequest } from '@omni/shared/pr-auto-merge.ts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { space, useOmniTheme } from '../theme';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { GroupedList, ListRow } from '../ui/GroupedList';
import { Icon } from '../ui/Icon';
import { SlideToConfirm } from '../ui/SlideToConfirm';
import { useAutoMerge } from './hooks';

/**
 * The PR screen's auto-merge row, as on phone web. Off: a tap shows the same slide to confirm as a merge, with the
 * repo's merge method. On: its method and who turned it on, and Turn off. gh's refusal shows under it.
 */
export function AutoMergeRow({ channelId, number, request, draft, reload }: { channelId: string | null; number: number; request: AutoMergeRequest | null | undefined; draft: boolean; reload: () => void }) {
  const { colors } = useOmniTheme();
  const a = useAutoMerge(channelId, number, reload);
  const [arming, setArming] = useState(false);
  const { on, title, detail, by } = autoMergeView(request);

  return (
    <View style={styles.block}>
      {arming && !on ? (
        <View style={styles.block}>
          <SlideToConfirm
            label={AUTO_MERGE_COPY.slide}
            busyLabel={AUTO_MERGE_COPY.busy}
            doneLabel={AUTO_MERGE_COPY.done}
            onConfirm={async () => {
              try {
                await a.set(true);
                setArming(false);
                return true;
              } catch {
                return false;
              }
            }}
          />
          <Button variant="ghost" label="Cancel" onPress={() => setArming(false)} />
        </View>
      ) : (
        <GroupedList>
          <ListRow
            first
            title={title}
            detail={by ? `${detail}. ${by}.` : detail}
            leading={<Icon name="zap" size={18} color={on ? colors.live : colors.fg2} />}
            trailing={on ? <Button size="compact" variant="secondary" label={AUTO_MERGE_COPY.disarm} busy={a.busy} onPress={() => void a.set(false).catch(() => {})} /> : undefined}
            chevron={!on && !draft}
            disabled={!on && draft}
            onPress={on || draft ? undefined : () => setArming(true)}
            accessibilityHint={on ? undefined : 'Shows a slider that turns on auto-merge'}
          />
        </GroupedList>
      )}
      {a.error ? <Callout message={a.error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space.s4,
  },
});
