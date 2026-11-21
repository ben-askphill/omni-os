import type { CharacterFace, FaceShows } from '@omni/shared/agent-avatar.ts';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import type { FileSource } from '../live/hub';
import { useAgents, useLiveHub } from '../live/react';
import { useOmniTheme } from '../theme';
import { agentFace, agentLook } from './agent-face';
import { ChannelAvatar } from './ChannelAvatar';

/**
 * An agent's avatar (ADR 0021): the image the user uploaded, else its icon or emoji on its color, else its crew
 * character. The rule is the shared agent face's (`agentFace`). `shows` is the status mark or member state behind it:
 * a character shows it in its eyes, a photo or an icon in the Working or Needs you ring (D8). Nothing shows idle eyes
 * and no ring. The author line, the member sheet, lanes, the To line and the thread's sub line draw it.
 */
export function AgentAvatar({ agent, size = 24, shows }: { agent: string; size?: number; shows?: FaceShows }) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  const face = agentFace(agent, agents, size, { shows });
  let drawn;
  switch (face.kind) {
    case 'image':
      drawn = <AvatarImage agent={face.agent} v={face.v} size={size} />;
      break;
    case 'icon':
      drawn = <ChannelAvatar name={agentLook(agent, agents).name} icon={face.icon} avatarBg={face.bg} size={size} />;
      break;
    case 'character':
      drawn = <Character face={face} />;
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
 * A crew character as the agent face draws it: inside the lean, its outline filled with the agent's color and stroked
 * in the theme's foreground, the Conductor's satellite in the same color, and the two eyes in the eye ink. No disc.
 */
function Character({ face }: { face: CharacterFace }) {
  const { colors } = useOmniTheme();
  const ring = colors[face.ring];
  return (
    <Svg width={face.size} height={face.size} viewBox={face.viewBox} accessible={false}>
      <G transform={face.lean}>
        <Path d={face.outline} fill={face.body} stroke={ring} strokeWidth={face.stroke} strokeLinejoin="round" />
        {face.satellite ? <Circle cx={face.satellite.cx} cy={face.satellite.cy} r={face.satellite.r} fill={ring} /> : null}
        {face.pair.map((eye, i) =>
          eye.line === null ? (
            <Path key={i} d={eye.path} fill={face.ink} />
          ) : (
            <Path key={i} d={eye.path} fill="none" stroke={face.ink} strokeWidth={eye.line} strokeLinecap="round" strokeLinejoin="round" />
          ),
        )}
      </G>
    </Svg>
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
