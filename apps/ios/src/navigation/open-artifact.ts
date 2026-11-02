import type { Artifact } from '@omni/client-core';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from './types';

/**
 * Opens an artifact's viewer in the calling screen's own tab. The thread body calls this when Ben taps an artifact
 * row, the Library when he taps a card. Pass the row as the server sent it: its `updated_at` picks the file's version.
 */
export function openArtifact(navigation: Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate'>, artifact: Artifact): void {
  navigation.navigate('Artifact', { artifact });
}
