import type { Artifact } from '@omni/client-core';
import { parseCsv } from '@omni/shared/artifacts.ts';
import type { File } from 'expo-file-system';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import { markdownDocument } from '../../artifacts/markdown';
import { sandboxHtml, svgDocument, type DocumentColors } from '../../artifacts/sandbox';
import { useArtifactFile } from '../../artifacts/use-artifact-file';
import { textPreview, viewerFor } from '../../artifacts/viewer-kind';
import { type ColorTokens, fontSize, space, useOmniTheme, weight } from '../../theme';
import { Button } from '../../ui/Button';
import { SandboxWebView } from './SandboxWebView';

/** The artifact itself, in the viewer its kind calls for. The file comes from the cache, fetched with the token first. */
export function ArtifactBody({ artifact, onFile }: { artifact: Artifact; onFile?: (file: File | null) => void }) {
  const { colors } = useOmniTheme();
  const load = useArtifactFile(artifact);
  const file = load.status === 'ready' ? load.file : null;

  useEffect(() => {
    onFile?.(file);
  }, [file, onFile]);

  if (load.status === 'loading') return <Centered><ActivityIndicator color={colors.fg3} /></Centered>;
  if (load.status === 'too-large') return <Notice text="This file is too large to open on the phone." />;
  if (load.status === 'error') return <Notice text={load.message} action={{ label: 'Try again', onPress: load.retry }} />;

  const kind = viewerFor(artifact.kind);
  switch (kind) {
    case 'image':
      return <ImageView file={load.file} name={artifact.name} />;
    case 'pdf':
      return <SandboxWebView content={{ kind: 'file', uri: load.file.uri }} scripts={false} background={colors.bg} label={artifact.name} />;
    case 'file':
      return <FileView file={load.file} />;
    default:
      return <TextBody kind={kind} artifactKind={artifact.kind} file={load.file} name={artifact.name} />;
  }
}

function TextBody({ kind, artifactKind, file, name }: { kind: 'page' | 'svg' | 'markdown' | 'table' | 'text'; artifactKind: string; file: File; name: string }) {
  const { colors } = useOmniTheme();
  const text = useFileText(file);
  if (text.status === 'loading') return <Centered><ActivityIndicator color={colors.fg3} /></Centered>;
  if (text.status === 'error') return <Notice text="Could not read this file." />;
  switch (kind) {
    case 'page':
      return <SandboxWebView content={{ kind: 'html', html: sandboxHtml(text.value) }} scripts background="#ffffff" label={name} />;
    case 'svg':
      return <SandboxWebView content={{ kind: 'html', html: svgDocument(text.value, colors) }} scripts={false} background={colors.bg} label={name} />;
    case 'markdown':
      return <SandboxWebView content={{ kind: 'html', html: markdownDocument(text.value, documentColors(colors)) }} scripts={false} background={colors.bg} label={name} />;
    case 'table':
      return <Table source={text.value} />;
    default:
      return <PlainText source={text.value} kind={artifactKind} />;
  }
}

const documentColors = (c: ColorTokens): DocumentColors => ({ bg: c.bg, fg: c.fg, fg2: c.fg2, fg3: c.fg3, surface: c.surface2, line: c.line });

type Read = { status: 'loading' } | { status: 'ready'; value: string } | { status: 'error' };

function useFileText(file: File): Read & { value: string } {
  const [read, setRead] = useState<Read>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading' });
    file.text().then(
      (value) => live && setRead({ status: 'ready', value }),
      () => live && setRead({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [file]);
  return { ...read, value: read.status === 'ready' ? read.value : '' };
}

/** Pinch to zoom up to 5x, double tap is UIKit's. The image fits the space at 1x. */
function ImageView({ file, name }: { file: File; name: string }) {
  const { colors } = useOmniTheme();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {size ? (
        <ScrollView
          minimumZoomScale={1}
          maximumZoomScale={5}
          centerContent
          bouncesZoom
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <Image source={{ uri: file.uri }} resizeMode="contain" accessibilityLabel={name} style={{ width: size.width, height: size.height }} />
        </ScrollView>
      ) : null}
    </View>
  );
}

const COLUMN = 148;

function Table({ source }: { source: string }) {
  const { colors } = useOmniTheme();
  const { rows, truncated } = useMemo(() => parseCsv(source), [source]);
  if (!rows.length) return <Notice text="Empty file" />;
  const [head, ...body] = rows as [string[], ...string[][]];
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentInsetAdjustmentBehavior="automatic">
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <Row cells={head} header />
          {body.map((cells, i) => (
            <Row key={i} cells={cells} />
          ))}
        </View>
      </ScrollView>
      {truncated ? <Text style={[styles.note, { color: colors.fg3 }]}>Showing the first 500 rows. Share the file for the rest.</Text> : null}
    </ScrollView>
  );
}

function Row({ cells, header = false }: { cells: string[]; header?: boolean }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.line, backgroundColor: header ? colors.surface : 'transparent' }]}>
      {cells.map((cell, i) => (
        <Text key={i} numberOfLines={header ? 1 : 3} style={[styles.cell, header ? styles.headCell : null, { color: header ? colors.fg3 : colors.fg }]}>
          {cell}
        </Text>
      ))}
    </View>
  );
}

function PlainText({ source, kind }: { source: string; kind: string }) {
  const { colors } = useOmniTheme();
  const { text, truncated } = useMemo(() => textPreview(source, kind), [source, kind]);
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.text} contentInsetAdjustmentBehavior="automatic">
      <Text selectable style={[styles.mono, { color: colors.fg2 }]}>
        {text}
      </Text>
      {truncated ? <Text style={[styles.note, { color: colors.fg3 }]}>Showing the start of the file. Share it for the rest.</Text> : null}
    </ScrollView>
  );
}

/** A kind the app does not draw. Quick Look can usually open it. */
function FileView({ file }: { file: File }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Notice
      text={error ?? 'No preview for this file type here.'}
      action={{
        label: 'Open in Quick Look',
        onPress: () => {
          setError(null);
          file.preview().catch(() => setError('Quick Look cannot open this file. Share it instead.'));
        },
      }}
    />
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

function Notice({ text, action }: { text: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useOmniTheme();
  return (
    <Centered>
      <Text style={[styles.noticeText, { color: colors.fg3 }]}>{text}</Text>
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </Centered>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s6,
    padding: space.s9,
  },
  noticeText: {
    fontSize: fontSize.body,
    textAlign: 'center',
  },
  fill: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cell: {
    width: COLUMN,
    paddingHorizontal: space.s4,
    paddingVertical: space.s4 - 1,
    fontSize: 12.5,
  },
  headCell: {
    fontFamily: 'Menlo',
    fontSize: fontSize.meta,
    fontWeight: weight.semibold,
  },
  text: {
    padding: space.s6,
  },
  mono: {
    fontFamily: 'Menlo',
    fontSize: 12,
    lineHeight: 18,
  },
  note: {
    fontSize: fontSize.meta,
    padding: space.s6,
  },
});
