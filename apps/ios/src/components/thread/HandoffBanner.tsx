import { takeoverNote } from '@omni/shared/handoff.ts';
import { handoffBanner, mayTakeOver, takeoverShown } from '@omni/shared/thread-machine.ts';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import type { ThreadView } from '../../live/hub';
import type { ThreadMachineControl } from '../../machine/hooks';
import { cancelLabel } from '../../machine/state';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../../theme';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';

type MachineActions = Pick<ThreadMachineControl, 'ui' | 'cancel' | 'ask' | 'cancelError'>;

/**
 * Between the header and the transcript: the handoff while it is under way or went wrong (with Cancel on the machine
 * that gave the thread, or asked for it, until the other one takes it), one quiet line once it settled, and the Take
 * over note when another machine holds the thread and nothing is moving it.
 */
export function HandoffBanner({ view, machine }: { view: ThreadView; machine: MachineActions }) {
  const { colors } = useOmniTheme();
  const { handoff } = view;
  const banner = handoffBanner(handoff, view.thread?.status);
  const takeover = takeoverShown(view.takeover, handoff);
  if (!banner && !takeover) return null;
  const cancelling = machine.ui.sending === 'cancel';

  return (
    <View style={styles.stack}>
      {banner?.size === 'line' ? (
        <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={[styles.line, { color: colors.fg3 }]}>
          {banner.text}
        </Text>
      ) : null}
      {banner?.size === 'card' && handoff ? (
        <Card tone={banner.tone} lead={banner.tone === 'working' ? <ActivityIndicator color={colors.fg3} /> : <Glyph tone={banner.tone} />}>
          <Text style={[styles.text, { color: colors.fg }]}>{banner.text}</Text>
          {handoff.leftBehind ? <Text style={[styles.sub, { color: colors.fg3 }]}>{handoff.leftBehind}</Text> : null}
          {machine.cancelError ? <Callout message={machine.cancelError} /> : null}
          {banner.cancel ? (
            <View style={styles.action}>
              <Button
                label={cancelLabel(handoff)}
                variant="secondary"
                busy={cancelling}
                onPress={() => void machine.cancel()}
              />
            </View>
          ) : null}
        </Card>
      ) : null}
      {takeover ? (
        <Card tone="waiting" lead={<Glyph tone="waiting" />}>
          <Text style={[styles.text, { color: colors.fg }]}>{takeoverNote(takeover)}</Text>
          {takeover.refused ? <Text style={[styles.sub, { color: colors.fg3 }]}>{takeover.refused}</Text> : null}
          <View style={styles.action}>
            <Button label="Take over" disabled={!mayTakeOver(takeover, handoff)} onPress={machine.ask} />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

function Card({ tone, lead, children }: { tone: 'working' | 'waiting' | 'alert'; lead: ReactNode; children: ReactNode }) {
  const { colors } = useOmniTheme();
  return (
    <View
      accessibilityRole={tone === 'alert' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: tone === 'alert' ? colors.fg : colors.line }]}
    >
      <View style={styles.lead}>{lead}</View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

function Glyph({ tone }: { tone: 'waiting' | 'alert' | 'working' }) {
  const { colors } = useOmniTheme();
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.glyph, { color: tone === 'alert' ? colors.fg : colors.fg3 }]}>
      {tone === 'alert' ? '⚠' : '◷'}
    </Text>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space.s4,
    paddingHorizontal: space.s9,
    paddingBottom: space.s4,
  },
  line: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  card: {
    flexDirection: 'row',
    gap: space.s6,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.s8,
  },
  lead: {
    width: 24,
    alignItems: 'center',
    paddingTop: 1,
  },
  body: {
    flex: 1,
    gap: space.s4,
  },
  text: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  sub: {
    fontSize: fontSize.body - 1,
    lineHeight: Math.round((fontSize.body - 1) * lineHeight.body),
  },
  action: {
    alignSelf: 'flex-start',
  },
  glyph: {
    fontSize: 18,
  },
});
