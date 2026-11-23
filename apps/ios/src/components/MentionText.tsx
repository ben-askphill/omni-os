// Machine and agent mentions drawn inline in a sent, queued or sending message, as the Web UI's MentionText draws them
// (apps/web/src/message-context/MentionText.tsx): a pill with an agent's avatar on its own color, or a machine's monitor
// icon on the live blue, then the name. Both draw from @omni/shared/mention-pill.ts. The records are untouched: this is
// how a mention looks, not what the message carries.
import { mentionPieces, type MentionSpan } from '@omni/shared/message-context-machine.ts';
import { MENTION_PILL, mentionPillLook, mentionPillName } from '@omni/shared/mention-pill.ts';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { useAgents } from '../live/react';
import { useOmniTheme, weight } from '../theme';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { agentColor } from './agent-face';
import { AgentAvatar } from './AgentAvatar';

/** React Native's size when a style sets none. */
const DEFAULT_SIZE = 14;

/**
 * How far down an inline view sits from where iOS places it. React Native puts an inline view's bottom one font descent
 * above its line's bottom, and a line taller than the font raises the text by half the difference, so the pill moves
 * down by both to sit on its line as the web's inline-flex pill does. SF Pro's descent is 0.24 em and its line 1.19 em.
 */
export const pillDrop = (fontSize: number, lineHeight: number) => Math.round((0.24 * fontSize + Math.max(0, lineHeight - 1.19 * fontSize) / 2) * 10) / 10;

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
          transform: [{ translateY: pillDrop(fontSize, lineHeight) }],
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
 * A message's text with each agent or machine it mentions as a pill. A message with none is plain text. VoiceOver reads
 * the text as written, `@` names and all, since a pill is a view in the line and not its words.
 */
export function MentionText({ text, records, style, numberOfLines, selectable = true }: { text: string; records: unknown; style: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean }) {
  const pieces = mentionPieces(text, records);
  if (!pieces.some((p) => p.span))
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
      {pieces.map((p, i) => (p.span ? <Pill key={i} span={p.span} name={mentionPillName(p.text)} fontSize={fontSize} lineHeight={lineHeight} /> : p.text))}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center' },
});
