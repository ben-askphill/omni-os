import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

import { fromDocumentAsset, fromImageAsset, MAX_ATTACHMENTS, type Staged } from './model';

export type Pick = 'photo' | 'camera' | 'file';

/** What a picker gave back. `cancelled` is Ben backing out, which needs no message. */
export type Picked = { kind: 'files'; files: Staged[] } | { kind: 'cancelled' } | { kind: 'denied'; message: string } | { kind: 'failed'; message: string };

let counter = 0;
const nextId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const CAMERA_DENIED = 'Camera access is off for Omni OS. Turn it on in Settings to take a photo.';
export const LIBRARY_DENIED = 'Photo access is off for Omni OS. Turn it on in Settings to pick a photo.';
export const NO_CAMERA = 'This device has no camera.';

/** Opens the Settings page for this app, for a denied permission. */
export const openSettings = () => void Linking.openSettings();

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The photo library, up to the room left in the message. A HEIC photo is handed over as a JPEG (the compatible
 * representation), because the server shows only PNG, JPEG, GIF and WebP as images.
 */
async function photos(room: number): Promise<Picked> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, room),
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return { kind: 'cancelled' };
  const now = Date.now();
  return { kind: 'files', files: result.assets.map((a, i) => fromImageAsset(a, nextId(), 'library', now + i)) };
}

async function camera(): Promise<Picked> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { kind: 'denied', message: CAMERA_DENIED };
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] });
  if (result.canceled) return { kind: 'cancelled' };
  const now = Date.now();
  return { kind: 'files', files: result.assets.map((a, i) => fromImageAsset(a, nextId(), 'camera', now + i)) };
}

async function files(): Promise<Picked> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return { kind: 'cancelled' };
  return { kind: 'files', files: result.assets.map((a) => fromDocumentAsset(a, nextId())) };
}

/** Never rejects. `room` is how many more files the message can take. */
export async function pickFiles(which: Pick, room: number): Promise<Picked> {
  if (room <= 0) return { kind: 'failed', message: `At most ${MAX_ATTACHMENTS} files per message.` };
  try {
    if (which === 'photo') return await photos(room);
    if (which === 'camera') return await camera();
    return await files();
  } catch (e) {
    const text = message(e);
    if (which === 'camera' && /camera|simulator|not available/i.test(text)) return { kind: 'failed', message: NO_CAMERA };
    if (which === 'photo' && /permission|denied|authoriz/i.test(text)) return { kind: 'denied', message: LIBRARY_DENIED };
    return { kind: 'failed', message: text };
  }
}
