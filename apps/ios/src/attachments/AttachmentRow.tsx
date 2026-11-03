import type { Attachment } from '@omni/client-core';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, Share, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import type { FileSource, LiveHub } from '../live/hub';
import { useLiveHub } from '../live/react';
import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../theme';
import { formatBytes } from './model';

const THUMB = 132;

/**
 * The files a message carried, drawn under its text. Images are thumbnails that open full screen; anything else is a
 * row that downloads the file and opens it in Quick Look, or in the share sheet when Quick Look cannot show it. The
 * server asks for the bearer token on every file, so each request carries it. Self-contained: it needs only the
 * thread's id and the message's `attachments`.
 */
export function AttachmentRow({ threadId, items }: { threadId: string; items: readonly Attachment[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (items.length === 0) return null;
  const images = items.filter((a) => a.image);
  const files = items.filter((a) => !a.image);
  return (
    <View style={styles.wrap}>
      {images.length > 0 ? (
        <View style={styles.images}>
          {images.map((a) => (
            <Pressable key={a.name} accessibilityRole="imagebutton" accessibilityLabel={`Open ${a.name}`} onPress={() => setViewing(a)}>
              <RemoteImage threadId={threadId} name={a.name} style={styles.thumb} resizeMode="cover" />
            </Pressable>
          ))}
        </View>
      ) : null}
      {files.map((a) => (
        <FileLine key={a.name} threadId={threadId} file={a} />
      ))}
      <Viewer threadId={threadId} image={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

/** The address and token for a thread's file. Undefined while the session is looked up, null when it has no server. */
function useFileSource(threadId: string, name: string): FileSource | null | undefined {
  const hub = useLiveHub();
  const [source, setSource] = useState<FileSource | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void hub.fileSource(threadId, name).then((s) => live && setSource(s));
    return () => {
      live = false;
    };
  }, [hub, threadId, name]);
  return source;
}

function RemoteImage({ threadId, name, style, resizeMode }: { threadId: string; name: string; style: object; resizeMode: 'cover' | 'contain' }) {
  const { colors } = useOmniTheme();
  const source = useFileSource(threadId, name);
  const [failed, setFailed] = useState(false);
  // A new address or token (the phone was paired again) deserves another try.
  const retryKey = source ? `${source.uri}|${JSON.stringify(source.headers)}` : '';
  useEffect(() => setFailed(false), [retryKey]);
  if (failed || !source) {
    return (
      <View style={[style, styles.placeholder, { backgroundColor: colors.surface3 }]}>
        {failed || source === null ? <Text style={[styles.placeholderText, { color: colors.fg3 }]}>Can’t load image</Text> : <ActivityIndicator color={colors.fg3} />}
      </View>
    );
  }
  return <Image accessibilityLabel={name} source={{ uri: source.uri, headers: source.headers }} style={style} resizeMode={resizeMode} onError={() => setFailed(true)} />;
}

/** Downloads a thread's file into the cache, under its own name, and returns where it landed. */
async function download(hub: LiveHub, threadId: string, name: string): Promise<File> {
  const source = await hub.fileSource(threadId, name, { download: true });
  if (!source) throw new Error('This phone is not signed in to a server.');
  const dir = new Directory(Paths.cache, 'attachments', threadId);
  dir.create({ intermediates: true, idempotent: true });
  return File.downloadFileAsync(source.uri, new File(dir, name), { headers: source.headers, idempotent: true });
}

async function share(hub: LiveHub, threadId: string, name: string): Promise<void> {
  const file = await download(hub, threadId, name);
  await Share.share({ url: file.uri });
}

async function open(hub: LiveHub, threadId: string, name: string): Promise<void> {
  const file = await download(hub, threadId, name);
  if (await File.canPreview(file)) await File.preview(file);
  else await Share.share({ url: file.uri });
}

const reason = (e: unknown) => (/\b401\b|unauthor/i.test(String(e)) ? 'This phone is no longer signed in.' : 'Check the connection and try again.');

function FileLine({ threadId, file }: { threadId: string; file: Attachment }) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function press() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await open(hub, threadId, file.name);
    } catch (e) {
      setError(`Couldn’t open ${file.name}. ${reason(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${file.name}`}
        accessibilityState={{ busy }}
        onPress={() => void press()}
        style={({ pressed }) => [styles.file, { backgroundColor: pressed ? colors.surface3 : colors.surface, borderColor: colors.line }]}
      >
        <Text style={styles.fileGlyph}>📄</Text>
        <View style={styles.fileText}>
          <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.fileName, { color: colors.fg }]}>
            {file.name}
          </Text>
          {file.size > 0 ? <Text style={[styles.fileSize, { color: colors.fg3 }]}>{formatBytes(file.size)}</Text> : null}
        </View>
        {busy ? <ActivityIndicator size="small" color={colors.fg3} /> : null}
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.fg2 }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function Viewer({ threadId, image, onClose }: { threadId: string; image: Attachment | null; onClose: () => void }) {
  const hub = useLiveHub();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [image]);

  async function send() {
    if (!image) return;
    try {
      await share(hub, threadId, image.name);
    } catch (e) {
      setError(`Couldn’t share ${image.name}. ${reason(e)}`);
    }
  }

  return (
    <Modal visible={image !== null} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.viewer}>
        <View style={styles.viewerBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Share" onPress={() => void send()} hitSlop={8} style={styles.viewerSide}>
            <Text style={styles.viewerAction}>Share</Text>
          </Pressable>
          <Text numberOfLines={1} ellipsizeMode="middle" style={styles.viewerTitle}>
            {image?.name}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={[styles.viewerSide, styles.viewerEnd]}>
            <Text style={styles.viewerAction}>Done</Text>
          </Pressable>
        </View>
        {image ? <RemoteImage threadId={threadId} name={image.name} style={styles.viewerImage} resizeMode="contain" /> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.viewerError}>
            {error}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.s4,
    paddingTop: space.s2,
  },
  images: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.s4,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md - 2,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s4,
  },
  placeholderText: {
    fontSize: fontSize.meta,
    textAlign: 'center',
  },
  file: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    paddingHorizontal: space.s6,
    paddingVertical: space.s2,
    borderRadius: radius.md - 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileGlyph: {
    fontSize: 22,
  },
  fileText: {
    flexShrink: 1,
    gap: 1,
  },
  fileName: {
    fontSize: fontSize.body,
    fontWeight: weight.medium,
  },
  fileSize: {
    fontSize: fontSize.meta,
  },
  error: {
    fontSize: fontSize.meta,
    paddingTop: space.s2,
  },
  viewer: {
    flex: 1,
    backgroundColor: '#000000',
    paddingTop: space.s11,
    paddingBottom: space.s10,
  },
  viewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.s8,
    minHeight: minTarget,
  },
  viewerSide: {
    width: 64,
    minHeight: minTarget,
    justifyContent: 'center',
  },
  viewerEnd: {
    alignItems: 'flex-end',
  },
  viewerTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#ffffff',
    fontSize: fontSize.body,
    fontWeight: weight.semibold,
  },
  viewerAction: {
    color: '#ffffff',
    fontSize: fontSize.input,
    fontWeight: weight.semibold,
  },
  viewerImage: {
    flex: 1,
  },
  viewerError: {
    color: '#ffffff',
    textAlign: 'center',
    fontSize: fontSize.meta + 1,
    padding: space.s6,
  },
});
