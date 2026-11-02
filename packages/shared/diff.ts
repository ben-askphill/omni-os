// The diff model every diff view shares: a unified diff cut into files and numbered lines. The PR page's diff and a
// thread's Changes panel both draw it with DiffFile (components/DiffViewer.tsx). apps/mac/OmniKit's DiffParser.swift is the
// same model; keep the two in step.

export type DiffLineKind = 'hunk' | 'add' | 'del' | 'context' | 'note';

export interface DiffLine {
  kind: DiffLineKind;
  /** The line as the diff has it, with its `+`, `-` or space (and a `\r` a CRLF file ends it with). */
  text: string;
  /** Its number in the old file (`del`, `context`) and in the new one (`add`, `context`). Null otherwise. */
  old: number | null;
  new: number | null;
}

export interface FileDiff {
  path: string;
  /** Everything before the first hunk: `diff --git`, index, mode, rename lines. */
  header: string[];
  /** The hunks, `@@` lines included. */
  lines: DiffLine[];
  add: number;
  del: number;
  binary: boolean;
}

/** Lines drawn per file before "Show N more lines". */
export const MAX_LINES = 1500;
/** More files than this and the long ones start closed. */
export const MANY_FILES = 12;
/** A file with this many changes or more starts closed in a big diff. */
export const LONG_FILE = 200;

export const startsOpen = (f: FileDiff, fileCount: number) => fileCount <= MANY_FILES || f.add + f.del < LONG_FILE;

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiff(src: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;
  const rows = src.split('\n');
  // A diff ends in a newline; that is not an empty line of the last hunk.
  if (rows[rows.length - 1] === '') rows.pop();
  for (const line of rows) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      cur = { path: m ? m[2] : line.slice(11), header: [line], lines: [], add: 0, del: 0, binary: false };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) {
      if (line.trim()) {
        cur = { path: '(diff)', header: [], lines: [], add: 0, del: 0, binary: false };
        files.push(cur);
      } else continue;
    }
    if (!inHunk && !line.startsWith('@@')) {
      if (line.startsWith('Binary files')) cur.binary = true;
      if (line.startsWith('rename to ')) cur.path = line.slice(10);
      cur.header.push(line);
      continue;
    }
    inHunk = true;
    if (line.startsWith('@@')) {
      const m = line.match(HUNK);
      oldNo = m ? Number(m[1]) : 0;
      newNo = m ? Number(m[2]) : 0;
      cur.lines.push({ kind: 'hunk', text: line, old: null, new: null });
    } else if (line.startsWith('+')) {
      cur.add++;
      cur.lines.push({ kind: 'add', text: line, old: null, new: newNo ? newNo++ : null });
    } else if (line.startsWith('-')) {
      cur.del++;
      cur.lines.push({ kind: 'del', text: line, old: oldNo ? oldNo++ : null, new: null });
    } else if (line.startsWith('\\')) {
      cur.lines.push({ kind: 'note', text: line, old: null, new: null });
    } else {
      cur.lines.push({ kind: 'context', text: line, old: oldNo ? oldNo++ : null, new: newNo ? newNo++ : null });
    }
  }
  return files;
}
