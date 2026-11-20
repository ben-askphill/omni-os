import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import type { FileSource } from '../live/hub';
import { useAgents, useLiveHub } from '../live/react';
import { rounded, useOmniTheme, weight } from '../theme';
import { CrewMark } from '../ui/Brand';
import { Text } from '../ui/Text';
import { agentFace, agentLook } from './agent-face';
import { ChannelAvatar } from './ChannelAvatar';

/** The ring a header or tab avatar gets while its agent works, or waits on the user (ADR 0019, How it looks). */
export type AvatarRing = 'working' | 'needs' | null;

/**
 * An agent's avatar (ADR 0019): the image the user uploaded, else its icon or emoji on its color, else a built-in's
 * mark, else two letters unique across agents on a disc, its color only below 18px. The rule is `agentFace`, the
 * Web UI's. The author line, the member sheet, lanes, the To line and the thread's sub line draw it.
 */
export function AgentAvatar({ agent, size = 24, ring = null }: { agent: string; size?: number; ring?: AvatarRing }) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  const face = agentFace(agent, agents, size);
  const round = { width: size, height: size, borderRadius: size / 2 };
  let drawn;
  switch (face.kind) {
    case 'image':
      drawn = <AvatarImage agent={face.agent} v={face.v} size={size} />;
      break;
    case 'icon':
      drawn = <ChannelAvatar name={agentLook(agent, agents).name} icon={face.icon} avatarBg={face.bg} size={size} />;
      break;
    case 'mark':
      drawn = (
        <View style={[styles.center, round, { backgroundColor: colors.surface2 }]}>
          <CrewMark role={face.role} size={Math.round(size * 0.56)} />
        </View>
      );
      break;
    case 'disc':
      drawn = (
        <View style={[styles.center, round, { backgroundColor: face.bg }]}>
          {face.letters ? <Text style={[styles.letters, { color: face.ink, fontSize: size * 0.4, lineHeight: size * 0.5 }]}>{face.letters}</Text> : null}
        </View>
      );
      break;
  }
  const wrapped = (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      {drawn}
    </View>
  );
  if (!ring) return wrapped;
  const gap = 2;
  return (
    <View style={[styles.center, { width: size + 2 * (gap + 1.5), height: size + 2 * (gap + 1.5), borderRadius: size, borderWidth: 1.5, borderColor: ring === 'needs' ? colors.needs : colors.live }]}>
      {wrapped}
    </View>
  );
}

/** An uploaded avatar, read with the token from the agent's own path. The disc's color stands in while it loads or if it fails. */
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
  letters: {
    fontFamily: rounded,
    fontWeight: weight.medium,
  },
});
