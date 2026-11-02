import type { File } from 'expo-file-system';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';

import { shareableFile } from '../artifacts/files';
import { agoPhrase, formatBytes } from '../artifacts/viewer-kind';
import { ArtifactBody } from '../components/artifact/ArtifactBody';
import { HeaderButton } from '../components/HeaderButton';
import { shortAgo } from '../live/channel-model';
import { useLibrary } from '../live/react';
import type { RootScreenProps } from '../navigation/types';
import { fontSize, space, useOmniTheme } from '../theme';

/**
 * One file, opened from the Library or a thread. If the file is rewritten while it is open, the Library's live list
 * carries the new version and the viewer follows it, as phone web does.
 */
export function ArtifactScreen({ navigation, route }: RootScreenProps<'Artifact'>) {
  const { colors } = useOmniTheme();
  const opened = route.params.artifact;
  const { artifacts } = useLibrary();
  const artifact = useMemo(() => {
    const latest = artifacts?.find((a) => a.id === opened.id);
    return latest && latest.updated_at > opened.updated_at ? latest : opened;
  }, [artifacts, opened]);

  const [file, setFile] = useState<File | null>(null);
  const onFile = useCallback((next: File | null) => setFile(next), []);
  const share = useCallback(async () => {
    if (!file) return;
    try {
      const copy = await shareableFile(file, artifact);
      await Share.share({ url: copy.uri });
    } catch {
      // Closing the sheet is not an error, and nothing else here is worth interrupting Ben for.
    }
  }, [file, artifact]);

  const published = artifact.url;
  useLayoutEffect(() => {
    navigation.setOptions({
      title: artifact.name,
      headerRight: () => (
        <View style={styles.actions}>
          {published ? <HeaderButton label="claude.ai" onPress={() => void Linking.openURL(published)} /> : null}
          {file ? <HeaderButton label="Share" onPress={() => void share()} /> : null}
        </View>
      ),
    });
  }, [navigation, artifact.name, published, file, share]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text numberOfLines={1} style={[styles.info, { color: colors.fg3, borderBottomColor: colors.line }]}>
        {`${artifact.kind} · ${formatBytes(artifact.size)} · ${published ? 'published' : 'updated'} ${agoPhrase(shortAgo(artifact.updated_at, Date.now()))}`}
      </Text>
      <View style={styles.body}>
        <ArtifactBody key={`${artifact.id}-${artifact.updated_at}`} artifact={artifact} onFile={onFile} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: space.s6,
  },
  info: {
    fontSize: fontSize.meta,
    paddingHorizontal: space.s9,
    paddingVertical: space.s4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: {
    flex: 1,
  },
});
