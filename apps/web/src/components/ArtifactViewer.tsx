import { parseCsv } from '@omni/shared/artifacts.ts';
import { useEffect, useMemo, useState } from 'react';
import { bytes, relTime } from '@omni/shared/format.ts';
import { artifactUrl, type Artifact } from '../api.ts';
import { useImageZoom, ZoomableImage, ZoomControls, type ImageZoom } from './ImageZoom.tsx';
import { Markdown } from './Markdown.tsx';
import { PublishedActions } from './Published.tsx';
import { ErrorNote, Icon, IconButton, IconLink, Loading, Modal, type IconName } from './ui.tsx';
import { href } from '../router.ts';

export const kindIcon = (kind: string): IconName =>
  kind === 'image' || kind === 'screenshot' ? 'image' : kind === 'html' || kind === 'svg' ? 'globe' : 'file';

/** Trailing build stamps agents add to file names: a short hex hash, or a date and time. */
const STAMP = /(?:[-_](?=[0-9a-f]*\d)[0-9a-f]{6,12}|[-_]\d{8}(?:[-_]\d{4,6})?)+$/i;

/** A file name as a person would title it: no extension, no trailing hash or date, words for dashes. */
export function artifactTitle(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  const words = (base.replace(STAMP, '') || base).replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

function useText(a: Artifact, enabled: boolean) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setError(null);
    fetch(artifactUrl(a))
      .then(async (r) => {
        if (!r.ok) throw new Error(`Could not load ${a.name} (${r.status})`);
        const t = await r.text();
        if (alive) setText(t);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [a.id, a.updated_at, a.name, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { text, error };
}

/** The widest a CSV column gets, in characters; a longer cell truncates and opens in full when clicked or focused. */
const CSV_COLUMN_CH = 60;

/**
 * Each column's width in characters: its longest cell, between 4 and CSV_COLUMN_CH. A fixed table layout needs them,
 * or a cell grows to its text and `truncate` never cuts it.
 */
export function csvColumns(rows: string[][]) {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, j) => (widths[j] = Math.min(CSV_COLUMN_CH, Math.max(widths[j] ?? 4, c.length))));
  return widths;
}

export function CsvTable({ text }: { text: string }) {
  const { rows, truncated } = useMemo(() => parseCsv(text), [text]);
  const widths = useMemo(() => csvColumns(rows), [rows]);
  if (!rows.length) return <div className="p-4 text-[13px] text-fg-3">Empty file</div>;
  const [head, ...body] = rows;
  // A ch is the width of a 0, and capitals and wide letters run past it: 1.2ch a character, plus each cell's px-3.
  const scaled = (ch: number) => Math.round(ch * 12) / 10;
  const width = (ch: number) => `calc(${scaled(ch)}ch + 1.5rem)`;
  return (
    <div className="scroll-thin h-full overflow-auto">
      <table className="min-w-full table-fixed border-collapse text-[12px]" style={{ width: `calc(${scaled(widths.reduce((a, b) => a + b, 0))}ch + ${widths.length * 1.5}rem)` }}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: width(w) }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 bg-surface">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="truncate border-b border-line px-3 py-2 text-left font-num text-[11px] font-medium text-fg-3" title={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="hover:bg-surface">
              {r.map((c, j) =>
                c.length > CSV_COLUMN_CH ? (
                  // Cut to the column; a click or Tab shows it whole.
                  <td key={j} tabIndex={0} className="cursor-pointer truncate border-b border-line px-3 py-1.5 align-top focus:cursor-auto focus:break-words focus:whitespace-pre-wrap" title={c}>
                    {c}
                  </td>
                ) : (
                  <td key={j} className="truncate border-b border-line px-3 py-1.5 align-top" title={c}>
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && <div className="p-2 text-[11.5px] text-fg-3">Showing the first 500 rows. Download for the full file.</div>}
    </div>
  );
}

function TextBody({ a }: { a: Artifact }) {
  const { text, error } = useText(a, true);
  if (error) return <ErrorNote className="m-3">{error}</ErrorNote>;
  if (text == null) return <Loading />;
  if (a.kind === 'markdown') {
    return (
      <div className="scroll-thin h-full overflow-auto px-5 py-4">
        <Markdown text={text} />
      </div>
    );
  }
  if (a.kind === 'csv') return <CsvTable text={text} />;
  let shown = text;
  if (a.kind === 'json') {
    try {
      shown = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* show raw */
    }
  }
  // JSON keeps its indentation and scrolls sideways; prose-like text wraps.
  const wrap = a.kind === 'json' ? 'whitespace-pre' : 'whitespace-pre-wrap break-words';
  return <pre className={`scroll-thin h-full overflow-auto p-3 font-mono text-[12px] leading-[1.55] text-fg-2 ${wrap}`}>{shown}</pre>;
}

const isImage = (a: Artifact) => a.kind === 'image' || a.kind === 'screenshot';

function ImageBody({ a, z }: { a: Artifact; z?: ImageZoom }) {
  const src = artifactUrl(a);
  const own = useImageZoom(src);
  return <ZoomableImage key={src} src={src} alt={a.name} z={z ?? own} />;
}

/** `zoom` lets the caller put an image's zoom controls in its header; without it the image keeps its own. */
export function ArtifactBody({ a, zoom }: { a: Artifact; zoom?: ImageZoom }) {
  const src = artifactUrl(a);
  if (a.kind === 'html' || a.kind === 'svg') {
    return <iframe key={src} title={a.name} src={src} sandbox="allow-scripts allow-popups" className="h-full w-full border-0 bg-white" />;
  }
  if (a.kind === 'pdf') {
    // Chrome refuses to run its PDF viewer inside a sandboxed iframe, so PDFs get a plain one.
    return <iframe key={src} title={a.name} src={src} className="h-full w-full border-0 bg-white" />;
  }
  if (isImage(a)) return <ImageBody a={a} z={zoom} />;
  if (['markdown', 'csv', 'json', 'text'].includes(a.kind)) return <TextBody a={a} />;
  return <div className="p-4 text-[13px] text-fg-3">No preview for this file type. Download it instead.</div>;
}

export function ArtifactActions({ a, onExpand }: { a: Artifact; onExpand?: () => void }) {
  return (
    <div className="flex items-center">
      <PublishedActions a={a} />
      {onExpand && <IconButton icon="maximize" label="Full screen" onClick={onExpand} size={15} />}
      <IconLink href={artifactUrl(a)} icon="external" label="Open in new tab" newTab />
      <IconLink href={artifactUrl(a, true)} icon="download" label="Download" download />
    </div>
  );
}

/** Header + body, with a full-screen mode. */
/** `from`: the delegated thread that made it, when a parent thread shows it, linked from its header. */
export function ArtifactViewer({ a, from }: { a: Artifact; from?: { id: string; title: string } }) {
  const [full, setFull] = useState(false);
  const zoom = useImageZoom(artifactUrl(a));
  const fullZoom = useImageZoom(artifactUrl(a));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 py-1.5 pr-1.5 pl-3 shadow-[0_1px_0_var(--line)]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface text-fg-3">
          <Icon name={kindIcon(a.kind)} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11.5px] font-medium">{a.name}</div>
          <div className="truncate font-num text-[11px] text-fg-3">
            {a.kind} · {bytes(a.size)} · {a.url ? 'published' : 'updated'} {relTime(a.updated_at)}
            {from && (
              <>
                {' · from '}
                <a href={href.thread(from.id)} title={`Open thread: ${from.title}`} className="font-sans text-fg-3 underline decoration-line underline-offset-2 hover:text-fg">
                  {from.title || 'Untitled'}
                </a>
              </>
            )}
          </div>
        </div>
        {isImage(a) && <ZoomControls z={zoom} />}
        <ArtifactActions a={a} onExpand={() => setFull(true)} />
      </div>
      <div className="min-h-0 flex-1">
        <ArtifactBody a={a} zoom={zoom} />
      </div>
      <Modal
        open={full}
        onClose={() => setFull(false)}
        wide
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0">
              <span className="block truncate">{artifactTitle(a.name)}</span>
              <span className="block truncate font-mono text-[length:var(--fs-code)] text-fg-3">{a.name}</span>
            </span>
            {isImage(a) && <ZoomControls z={fullZoom} />}
            <ArtifactActions a={a} />
          </span>
        }
      >
        <div className="h-[80vh] border-t border-line">
          <ArtifactBody a={a} zoom={fullZoom} />
        </div>
      </Modal>
    </div>
  );
}
