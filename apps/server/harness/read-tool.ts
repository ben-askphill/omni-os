// The worktree read tool as the remote harness protocol carries it (group threads slice 5, ADR 0020): the definition
// Omni offers a remote agent on a turn, the arguments a call comes with, and the tool row the thread shows for it.
// Pure: the reading itself is apps/server/worktree-read.ts. docs/internals/remote-harness-protocol.md, the read call.

/** The tool's name on the wire, in a Runs API run's `tools` and in an eve agent's own tool. */
export const READ_TOOL = 'omni_worktree';

/** The most of a file, a search or a diff one call returns: 1 MB (Q66). */
export const READ_CAP = 1_000_000;

export type ReadAction = 'list' | 'read' | 'search' | 'diff';

export interface ReadArgs {
  action: ReadAction | string;
  path?: string;
  pattern?: string;
}

/** A client-side tool as POST /v1/runs takes it: a name, what it does and a JSON Schema for its arguments. */
export interface ClientTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const READ_TOOL_DEF: ClientTool = {
  name: READ_TOOL,
  description:
    "Read the thread's work in Omni, on the user's machine: its git-tracked files and its diff. Read-only. " +
    '`list` names the tracked files (under `path`, if given), `read` returns one file\'s text (`path`), `search` finds lines matching `pattern`, ' +
    "an extended regular expression (under `path`, if given), and `diff` returns the thread's changed files and diff since its base. " +
    'Untracked and ignored files, binary files and paths outside the worktree are refused; text past 1 MB comes back cut with a note. ' +
    'It works only during the turn Omni offered it on.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'read', 'search', 'diff'] },
      path: { type: 'string', description: "A path relative to the worktree's root, such as src/a.ts." },
      pattern: { type: 'string', description: 'For search: an extended regular expression.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A call's arguments, which a server may send as an object or as JSON text. Null when they are neither. */
export function readArgs(raw: unknown): ReadArgs | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return { action: str(o.action), ...(typeof o.path === 'string' && { path: o.path }), ...(typeof o.pattern === 'string' && { pattern: o.pattern }) };
}

/** The tool row a call shows as, under the names the transcript already draws (Read, Glob, Grep). */
export function readRow(raw: unknown): { name: string; input: Record<string, unknown> } {
  const a = readArgs(raw);
  const path = a?.path?.trim() ?? '';
  switch (a?.action) {
    case 'read':
      return { name: 'Read', input: { file_path: path } };
    case 'list':
      return { name: 'Glob', input: { pattern: path ? `${path.replace(/\/+$/, '')}/**` : '**' } };
    case 'search':
      return { name: 'Grep', input: { pattern: a.pattern ?? '', ...(path && { path }) } };
    case 'diff':
      return { name: 'Diff', input: { description: "The thread's diff and changed files" } };
    default:
      return { name: READ_TOOL, input: a ? { ...a } : {} };
  }
}
