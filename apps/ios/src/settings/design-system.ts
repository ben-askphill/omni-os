import { readDesignSystem } from '@omni/shared/design-system.ts';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

/** A design system from Files: its name and its HTML, checked as the server checks it. Null when the picker was closed. */
export async function pickDesignSystem(): Promise<{ name: string; html: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'text/html', copyToCacheDirectory: true });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  return { name: asset.name, html: readDesignSystem(await new File(asset.uri).text()) };
}
