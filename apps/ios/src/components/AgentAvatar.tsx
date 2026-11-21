import type { CharacterFace, CrewEye, FacePlacement, FaceShows } from '@omni/shared/agent-avatar.ts';
import { useEffect, useState, type ComponentClass } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, G, Path, type GProps } from 'react-native-svg';

import type { FileSource } from '../live/hub';
import { useAgents, useLiveHub } from '../live/react';
import { useOmniTheme } from '../theme';
import { agentFace, agentLook, type AgentLook } from './agent-face';
import { ChannelAvatar } from './ChannelAvatar';
import { useCrewMotion, type EyeProps } from './use-crew-motion';

/** A group whose transform Reanimated sets on the UI thread through `matrix`, react-native-svg's native one. */
const AnimatedG = Animated.createAnimatedComponent(G as unknown as ComponentClass<GProps & Partial<EyeProps>>);

/**
 * An agent's avatar (ADR 0021): the image the user uploaded, else its icon or emoji on its color, else its crew
 * character. The rule is the shared agent face's (`agentFace`). `shows` is the status mark or member state behind it:
 * a character shows it in its eyes, a photo or an icon in the Working or Needs you ring (D8). Nothing shows idle eyes
 * and no ring. `placement` is where it sits (the shared agent face's): a character in focus or in a row moves as the
 * face says (useCrewMotion), loops in focus and a change of state in a row, unless Reduce Motion is on. The author
 * line, the member sheet, lanes, the To line, the thread's sub line and the thread rows draw it.
 */
export function AgentAvatar({ agent, size = 24, shows, placement }: { agent: string; size?: number; shows?: FaceShows; placement?: FacePlacement }) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  const reduced = useReducedMotion();
  const face = agentFace(agent, agents, size, { shows, placement });
  let drawn;
  switch (face.kind) {
    case 'image':
      drawn = <AvatarImage agent={face.agent} v={face.v} size={size} />;
      break;
    case 'icon':
      drawn = <ChannelAvatar name={agentLook(agent, agents).name} icon={face.icon} avatarBg={face.bg} size={size} />;
      break;
    case 'character':
      drawn =
        (placement === 'focus' || placement === 'row') && !reduced ? (
          <MovingCharacter agent={agent} agents={agents} size={size} shows={shows} placement={placement} />
        ) : (
          <Character face={face} />
        );
      break;
  }
  const wrapped = (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      {drawn}
    </View>
  );
  if (face.kind === 'character' || !face.ring) return wrapped;
  const gap = 2;
  return (
    <View style={[styles.center, { width: size + 2 * (gap + 1.5), height: size + 2 * (gap + 1.5), borderRadius: size, borderWidth: 1.5, borderColor: face.ring === 'needs' ? colors.needs : colors.live }]}>
      {wrapped}
    </View>
  );
}

/**
 * A character that moves (ADR 0021, Motion): the pop plays on the outer view and the body's loops and hop on the inner
 * one, about the origins the face names, so neither fights the other; each eye moves in its own group.
 */
function MovingCharacter({ agent, agents, size, shows, placement }: { agent: string; agents: readonly AgentLook[]; size: number; shows?: FaceShows; placement: FacePlacement }) {
  const { face, body, pop, eyes } = useCrewMotion(agent, agents, size, shows, placement);
  if (face.kind !== 'character') return null;
  return (
    <Animated.View style={pop}>
      <Animated.View style={body}>
        <Character face={face} eyes={eyes} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * A crew character as the agent face draws it: inside the lean, its outline filled with the agent's color and stroked
 * in the theme's foreground, the Conductor's satellite in the same color, and the two eyes in the eye ink. No disc.
 * `eyes`, when it moves, is each eye's motion.
 */
function Character({ face, eyes }: { face: CharacterFace; eyes?: readonly [Partial<EyeProps>, Partial<EyeProps>] }) {
  const { colors } = useOmniTheme();
  const ring = colors[face.ring];
  return (
    <Svg width={face.size} height={face.size} viewBox={face.viewBox} accessible={false}>
      <G transform={face.lean}>
        <Path d={face.outline} fill={face.body} stroke={ring} strokeWidth={face.stroke} strokeLinejoin="round" />
        {face.satellite ? <Circle cx={face.satellite.cx} cy={face.satellite.cy} r={face.satellite.r} fill={ring} /> : null}
        {face.pair.map((eye, i) => (
          <Eye key={i} eye={eye} ink={face.ink} moves={eyes?.[i]} />
        ))}
      </G>
    </Svg>
  );
}

/** One eye in the eye ink. One that moves sits in a group on its centre, which its motion moves and squashes about. */
function Eye({ eye, ink, moves }: { eye: CrewEye; ink: string; moves?: Partial<EyeProps> }) {
  const centred = moves ? `translate(${-eye.cx} ${-eye.cy})` : undefined;
  const glyph =
    eye.line === null ? (
      <Path transform={centred} d={eye.path} fill={ink} />
    ) : (
      <Path transform={centred} d={eye.path} fill="none" stroke={ink} strokeWidth={eye.line} strokeLinecap="round" strokeLinejoin="round" />
    );
  if (!moves) return glyph;
  return (
    <G transform={`translate(${eye.cx} ${eye.cy})`}>
      <AnimatedG animatedProps={moves}>{glyph}</AnimatedG>
    </G>
  );
}

/** An uploaded avatar, read with the token from the agent's own path. A plain circle stands in while it loads or if it fails. */
function AvatarImage({ agent, v, size }: { agent: string; v: string; size: number }) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const [source, setSource] = useState<FileSource | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void hub.avatarSource(agent, v).then((s) => live && setSource(s));
    return () => {
      live = false;
    };
  }, [hub, agent, v]);
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (!source || failed) return <View style={[round, { backgroundColor: colors.surface3 }]} />;
  return <Image accessible={false} source={source} onError={() => setFailed(true)} style={[round, { backgroundColor: colors.surface3 }]} />;
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
