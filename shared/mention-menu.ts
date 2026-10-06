// The composer's `@` menu as pure functions: the file being typed at the caret, and what picking a
// row does to the text. Which files exist is the server's to say (server/mentions.ts).

/** The `@name` being typed, with the caret in it. `end` is where the name ends. */
export interface FileQuery {
  query: string;
  /** Where the `@` is. */
  start: number;
  end: number;
}

/** What `/api/mentions` lists for a row. */
export interface FileMention {
  /** What goes after the `@`: `artifacts/report.html` for a thread's artifact, a repo-relative path otherwise. */
  insert: string;
  /** The file's own name, shown bold. */
  name: string;
  /** Where it lives, shown quiet: the thread, or the folder inside the repo. */
  detail: string;
  kind: 'artifact' | 'file';
}

const TYPING = /(?<![\w@/.-])@([A-Za-z0-9._\-/]*)$/;
const NAME_REST = /^[A-Za-z0-9._\-/]*/;

/** The mention being typed at the caret: an `@` that starts a word, and the path characters after it. */
export function fileQuery(text: string, caret: number): FileQuery | null {
  const m = TYPING.exec(text.slice(0, caret));
  if (!m) return null;
  const end = caret + NAME_REST.exec(text.slice(caret))![0].length;
  // Anything else glued on makes it an address or prose.
  if (end < text.length && !/\s/.test(text[end])) return null;
  return { query: m[1], start: m.index, end };
}

/** The text after picking a file: `@path ` in place of what was typed, with the caret after the space. */
export function pickFile(text: string, at: FileQuery, insert: string): { text: string; caret: number } {
  const after = text.slice(at.end);
  const put = `@${insert}${/^[ \t]/.test(after) ? '' : ' '}`;
  return { text: text.slice(0, at.start) + put + after, caret: at.start + insert.length + 2 };
}

/** The `@path` tokens in a message: the path as typed, without the `@` or trailing punctuation. */
export function mentionTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w@/.-])@([A-Za-z0-9._\-/]+)/g)) {
    const path = m[1].replace(/[.\-/]+$/, '');
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}
