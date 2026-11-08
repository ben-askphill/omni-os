import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import { blockedNote } from '@omni/shared/thread-machine.ts';

import type { ThreadView } from '../../live/hub';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../../theme';
import { StatusLine } from '../StatusLine';

interface ThreadHeaderProps {
  view: ThreadView;
  /** What the last menu action did, for a moment after the sheet closes. */
  flash: string | null;
}

/**
 * Above the transcript: the connection, a failed refresh, what the last menu action did, and why a turn cannot start
 * here. The status, channel and machine sit under the title in the navigation bar (ThreadTitle), the model in the
 * composer, and Changes and Pull request in the thread menu.
 */
export function ThreadHeader({ view, flash }: ThreadHeaderProps) {
  const { colors } = useOmniTheme();
  const { thread } = view;
  // The handoff card and the Take over note say it when they can, so the same sentence is not shown twice.
  const blocked = blockedNote(view.blocked, view.handoff, thread?.status, view.takeover);
  return (
    <>
      <View style={styles.statusBar}>
        <StatusLine />
        {view.error ? <Text style={[styles.meta, { color: colors.fg3 }]}>{`Last update failed: ${view.error}`}</Text> : null}
        {flash ? (
          <Text accessibilityLiveRegion="polite" style={[styles.meta, { color: colors.fg }]}>
            {flash}
          </Text>
        ) : null}
      </View>
      {blocked ? (
        <View style={[styles.blocked, { borderColor: colors.lineStrong }]}>
          <Text style={[styles.blockedText, { color: colors.fg }]}>{blocked}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  statusBar: {
    paddingHorizontal: space.s9,
    gap: space.s2,
  },
  meta: {
    fontSize: fontSize.small,
    paddingBottom: space.s2,
  },
  blocked: {
    marginHorizontal: space.s9,
    marginBottom: space.s4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.s8,
  },
  blockedText: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
