import { useEffect, useMemo, useState } from 'react';
import { artifactUrl, type Artifact } from '../api.ts';
import { bytes, relTime } from '../format.ts';
import { Markdown } from './Markdown.tsx';
import { ErrorNote, Icon, IconButton, IconLink, Loading, Modal, type IconName } from './ui.tsx';

export const kindIcon = (kind: string): IconName =>
  kind === 'image' || kind === 'screenshot' ? 'image' : kind === 'html' || kind === 'svg' ? 'globe' : 'file';

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

/** Minimal CSV parser: quotes, escaped quotes, commas and newlines inside quotes. */
function parseCsv(src: string, maxRows = 500) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length >= maxRows) return { rows, truncated: true };
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, truncated: false };
}

function CsvTable({ text }: { text: string }) {
  const { rows, truncated } = useMemo(() => parseCsv(text), [text]);
  if (!rows.length) return <div className="p-4 text-[13px] text-fg-3">Empty file</div>;
  const [head, ...body] = rows;
  return (
    <div className="scroll-thin h-full overflow-auto">
      <table className="min-w-full border-collapse text-[12px]">
        <thead className="sticky top-0 bg-surface">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-b border-line px-3 py-2 text-left font-num text-[10.5px] font-medium tracking-[0.04em] whitespace-nowrap text-fg-3 uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="hover:bg-surface">
              {r.map((c, j) => (
                <td key={j} className="max-w-[28rem] truncate border-b border-line px-3 py-1.5 align-top" title={c}>
                  {c}
                </td>
              ))}
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
  return <pre className="scroll-thin h-full overflow-auto p-3 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap break-words text-fg-2">{shown}</pre>;
}

export function ArtifactBody({ a }: { a: Artifact }) {
  const src = artifactUrl(a);
  if (a.kind === 'html' || a.kind === 'svg') {
    return <iframe key={src} title={a.name} src={src} sandbox="allow-scripts allow-popups" className="h-full w-full border-0 bg-white" />;
  }
  if (a.kind === 'pdf') {
    // Chrome refuses to run its PDF viewer inside a sandboxed iframe, so PDFs get a plain one.
    return <iframe key={src} title={a.name} src={src} className="h-full w-full border-0 bg-white" />;
  }
  if (a.kind === 'image' || a.kind === 'screenshot') {
    return (
      <div className="scroll-thin flex h-full items-start justify-center overflow-auto bg-surface-2 p-3">
        <img src={src} alt={a.name} className="max-w-full rounded-xl shadow-[var(--shadow-card)]" />
      </div>
    );
  }
  if (['markdown', 'csv', 'json', 'text'].includes(a.kind)) return <TextBody a={a} />;
  return <div className="p-4 text-[13px] text-fg-3">No preview for this file type. Download it instead.</div>;
}

export function ArtifactActions({ a, onExpand }: { a: Artifact; onExpand?: () => void }) {
  return (
    <div className="flex items-center">
      {onExpand && <IconButton icon="maximize" label="Full screen" onClick={onExpand} size={15} />}
      <IconLink href={artifactUrl(a)} icon="external" label="Open in new tab" newTab />
      <IconLink href={artifactUrl(a, true)} icon="download" label="Download" download />
    </div>
  );
}

/** Header + body, with a full-screen mode. */
export function ArtifactViewer({ a }: { a: Artifact }) {
  const [full, setFull] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 py-1.5 pr-1.5 pl-3 shadow-[0_1px_0_var(--line)]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface text-fg-3">
          <Icon name={kindIcon(a.kind)} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{a.name}</div>
          <div className="font-num text-[10.5px] text-fg-4">
            {a.kind} · {bytes(a.size)} · updated {relTime(a.updated_at)}
          </div>
        </div>
        <ArtifactActions a={a} onExpand={() => setFull(true)} />
      </div>
      <div className="min-h-0 flex-1">
        <ArtifactBody a={a} />
      </div>
      <Modal
        open={full}
        onClose={() => setFull(false)}
        wide
        title={
          <span className="flex items-center gap-2">
            {a.name}
            <ArtifactActions a={a} />
          </span>
        }
      >
        <div className="h-[80vh]">
          <ArtifactBody a={a} />
        </div>
      </Modal>
    </div>
  );
}
