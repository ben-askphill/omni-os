// Machine and agent mentions drawn inline in a sent, queued or sending message, as the Web UI's MentionText draws them
// (apps/web/src/message-context/MentionText.tsx): a pill with an agent's avatar on its own color, or a machine's monitor
// icon on the live blue, then the name. Both draw from @omni/shared/mention-pill.ts. The records are untouched: this is
// how a mention looks, not what the message carries.
import type { MentionSpan } from '@omni/shared/message-context-machine.ts';
import { MENTION_PILL, mentionPillLook } from '@omni/shared/mention-pill.ts';
import { slashPieces } from '@omni/shared/slash-pills.ts';
import type { SlashRecord } from '@omni/shared/slash.ts';
import { Fragment } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { useAgents } from '../live/react';
import { mono, radius, useOmniTheme, weight } from '../theme';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { agentColor } from './agent-face';
import { AgentAvatar } from './AgentAvatar';
import { mentionRuns } from './mention-runs';

/** React Native's size when a style sets none. */
const DEFAULT_SIZE = 14;
const ZWSP = '\u200b';

/**
 * How far down a pill moves from where iOS puts it. React Native sets an inline view's bottom one descent of TextKit's
 * default font (Helvetica 12, about 3pt) above the line's baseline, whatever the text's size or line height (measured
 * at 15/22, 20/30 and 15/18 on iOS 27), so the pill's name sat 3pt above the words beside it.
 */
const PILL_DROP = 3;

function Pill({ span, name, fontSize, lineHeight }: { span: MentionSpan; name: string; fontSize: number; lineHeight: number }) {
  const { colors, scheme } = useOmniTheme();
  const agents = useAgents();
  const agent = span.kind === 'agent' ? span.agent.agent : null;
  const look = mentionPillLook(agent ? { kind: 'agent', color: agentColor(agent, agents) } : { kind: 'machine' }, { scheme, fontSize, live: colors.live });
  const ink = look.ink === 'live' ? colors.live : colors.fg;
  return (
    <View
      style={[
        styles.pill,
        {
          height: lineHeight,
          gap: look.gap,
          paddingLeft: look.padLeft,
          paddingRight: look.padRight,
          borderRadius: look.radius,
          backgroundColor: look.fill,
          transform: [{ translateY: PILL_DROP }],
        },
      ]}
    >
      {agent ? <AgentAvatar agent={agent} size={look.mark} /> : <Icon name="machine" size={look.mark} strokeWidth={MENTION_PILL.iconStroke} color={ink} />}
      <Text numberOfLines={1} style={{ fontSize, lineHeight, color: ink, fontWeight: weight.regular }}>
        {name}
      </Text>
    </View>
  );
}

/**
 * A message's text with each agent or machine it mentions as a pill, and each command it names (`slash`, as the server
 * resolved it when sent) in mono on a quiet fill, as the Web UI's command pill. A message with neither is plain text.
 * VoiceOver reads the text as written, `@` names and all, since a pill is a view in the line and not its words.
 */
export function MentionText({
  text,
  records,
  slash,
  style,
  numberOfLines,
  selectable = true,
}: {
  text: string;
  records: unknown;
  slash?: SlashRecord;
  style: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
}) {
  const { colors } = useOmniTheme();
  const parts = slashPieces(text, slash).map((p) => ({ ...p, runs: p.hit ? null : mentionRuns(p.text, records) }));
  if (parts.every((p) => !p.hit && !p.runs))
    return (
      <Text selectable={selectable} style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  const flat = StyleSheet.flatten(style) ?? {};
  const fontSize = flat.fontSize ?? DEFAULT_SIZE;
  const lineHeight = flat.lineHeight ?? Math.round(fontSize * 1.19);
  return (
    <Text selectable={selectable} accessibilityLabel={text} style={style} numberOfLines={numberOfLines}>
      {parts.map((p, j) =>
        p.hit ? (
          <Text key={j} accessibilityHint={p.hit.description || undefined} style={[styles.command, { backgroundColor: colors.surface3, color: colors.fg }]}>
            {p.text}
          </Text>
        ) : !p.runs ? (
          p.text
        ) : (
          p.runs.map((r, i) =>
            r.kind === 'text' ? (
              r.text
            ) : (
              <Fragment key={`${j}.${i}`}>
                {r.opens ? ZWSP : null}
                <Pill span={r.span} name={r.name} fontSize={fontSize} lineHeight={lineHeight} />
              </Fragment>
            ),
          )
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center' },
  command: { fontFamily: mono, fontWeight: weight.medium, borderRadius: radius.xs },
});
