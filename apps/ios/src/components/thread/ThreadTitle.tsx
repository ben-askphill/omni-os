import type { ThreadStatus } from '@omni/client-core';
import type { FaceShows } from '@omni/shared/agent-avatar.ts';
import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { fontSize, useOmniTheme, weight } from '../../theme';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { glyphFor, StatusDot } from '../StatusDot';
import { AgentAvatar } from '../AgentAvatar';
import { TALKS_ONLY } from '@omni/shared/remote-agent.ts';

/** Room the back button and the menu button take on either side of the bar, as the design draws them (73 and 79). */
const SIDES = 73 + 79;
/** The member avatars beside the menu button in a group thread. */
const FACEPILE = 64;
/** What a squeezed channel, agent name or machine name keeps: room for its ellipsis at caption size. */
const KEEP = 14;
const MACHINE_ICON = 12;
const DEVICE_GAP = 3;
/** The least room the account shows in: its separator and a couple of letters before the ellipsis. */
const ACCOUNT_MIN = 32;
/** How far the avatar's Working or Needs you ring reaches past the 16pt line, above and below (AgentAvatar). */
const RING_ROOM = 4;

interface ThreadTitleProps {
  title: string;
  status: ThreadStatus | undefined;
  statusLabel: string;
  channel: string | null;
  /** The display name of the crew role the thread runs as (crewRoleName), null on a thread not started as one. */
  role?: string | null;
  device: string | null;
  /** The account the thread's harness runs as ("dev@example.com · Max"), after the machine. */
  account?: string | null;
  /** Opens the Runs on page. Without it the machine name is plain text: there is nothing to pick. */
  onOpenMachine?: () => void;
  /** The lead agent's id, for its avatar beside its name. */
  lead?: string | null;
  /** What the lead's eyes show: the thread's state, or in a group thread the lead's own (leadEyes). */
  leadShows?: FaceShows;
  /** A remote agent leads it: "talks only" after its name (ADR 0020). */
  talksOnly?: boolean;
  /** The member avatars sit beside the menu button, so the title takes less of the bar. */
  wide?: boolean;
}

/**
 * The open thread's navigation bar title, left-aligned: the title on one line, and under it the status dot and word,
 * the channel, the crew role it runs as and the machine the thread runs on. They replace the status and chips rows under the bar.
 */
export function ThreadTitle({ title, status, statusLabel, channel, role = null, device, account = null, onOpenMachine, lead = null, leadShows, talksOnly = false, wide = false }: ThreadTitleProps) {
  const { colors } = useOmniTheme();
  const { width } = useWindowDimensions();
  const live = status === 'running';
  const [accountFits, setAccountFits] = useState(true);
  const sep = (
    <Text accessibilityElementsHidden style={[styles.sub, { color: colors.fg4 }]}>
      ·
    </Text>
  );
  return (
    <View style={[styles.box, { width: Math.max(0, width - SIDES - (wide ? FACEPILE : 0)) }]}>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.fg }]}>
        {title}
      </Text>
      <View style={styles.row}>
        {statusLabel ? (
          <>
            <StatusDot glyph={glyphFor(status)} size={6} />
            <Text style={[styles.sub, { color: live ? colors.live : colors.fg2 }]}>{statusLabel}</Text>
          </>
        ) : null}
        {statusLabel && channel ? sep : null}
        {channel ? (
          <Text numberOfLines={1} style={[styles.sub, styles.shrink, { color: colors.fg3 }]}>
            #{channel}
          </Text>
        ) : null}
        {(statusLabel || channel) && role ? sep : null}
        {/* The open thread's agent is in focus: its character moves (ADR 0021, D10). The avatar sits in the row itself, not
            in a box that shrinks with the name, so a short row never pushes it over the machine. */}
        {role && lead ? <AgentAvatar agent={lead} size={16} shows={leadShows} placement="focus" /> : null}
        {role ? (
          <Text numberOfLines={1} accessibilityLabel={`Runs as ${role}${talksOnly ? `, ${TALKS_ONLY}` : ''}`} style={[styles.sub, styles.shrink, { color: colors.fg3 }]}>
            {talksOnly ? `${role} · ${TALKS_ONLY}` : role}
          </Text>
        ) : null}
        {(statusLabel || channel || role) && device ? sep : null}
        {device ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={account ? `Runs on ${device} as ${account}` : `Runs on ${device}`}
            accessibilityHint={onOpenMachine ? 'Opens the list of machines' : undefined}
            disabled={!onOpenMachine}
            hitSlop={{ top: 12, bottom: 12, left: 4, right: 8 }}
            onPress={onOpenMachine}
            style={({ pressed }) => [styles.device, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="machine" size={MACHINE_ICON} strokeWidth={2} color={colors.fg3} />
            <Text numberOfLines={1} style={[styles.sub, styles.shrink, { color: colors.fg3 }]}>
              {device}
            </Text>
          </Pressable>
        ) : null}
        {/* The account is the part the row needs least: it takes only the room the other items leave, and hides, separator
            and all, when that room is too small to read. The machine's button already names it to VoiceOver. */}
        {device && account ? (
          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            disabled={!onOpenMachine || !accountFits}
            hitSlop={{ top: 12, bottom: 12, right: 8 }}
            onPress={onOpenMachine}
            onLayout={(e) => setAccountFits(e.nativeEvent.layout.width >= ACCOUNT_MIN)}
            style={({ pressed }) => [styles.account, { opacity: accountFits ? (pressed ? 0.6 : 1) : 0 }]}
          >
            <Text numberOfLines={1} style={[styles.sub, { color: colors.fg3 }]}>
              · {account}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 2,
  },
  title: {
    fontSize: fontSize.heading,
    lineHeight: 22,
    fontWeight: weight.medium,
  },
  // A 16pt line that clips at the title's edge, so an item never draws into the header's buttons when even the shortest
  // the items can be does not fit. It is taller by the margins it gives back, so a Working ring round the avatar is not cut.
  row: {
    height: 16 + 2 * RING_ROOM,
    marginVertical: -RING_ROOM,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
    overflow: 'hidden',
  },
  sub: {
    fontSize: fontSize.caption,
    lineHeight: 16,
    fontWeight: weight.regular,
  },
  // The channel, the agent's name and the machine share what the row lacks, the longest giving up the most, and each keeps
  // at least its ellipsis: a squeezed item never shrinks to nothing between two separators.
  shrink: {
    flexShrink: 1,
    minWidth: KEEP,
  },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DEVICE_GAP,
    flexShrink: 1,
    minWidth: MACHINE_ICON + DEVICE_GAP + KEEP,
  },
  account: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
});
