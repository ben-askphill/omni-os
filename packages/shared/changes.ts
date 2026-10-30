// The wire types of a thread's Changes panel, the one copy the server (apps/server/changes.ts, turns.ts) and the web
// (apps/web/src/changes.ts) import: GET /api/threads/:id/changes (`BranchChanges`) and GET /api/threads/:id/turns
// (`TurnChanges`). The Mac app's Changes.swift mirrors them; apps/server/tests/mac-fixtures.test.ts checks its recorded
// answers with `changesProblems` and `turnChangesProblems`, and Changes.swift's value lists against the ones here.

/** `turn`: what one turn changed, between its before and after snapshots (apps/server/turns.ts). */
export const CHANGE_KINDS = ['committed', 'staged', 'unstaged', 'untracked', 'turn'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_STATUSES = ['added', 'modified', 'deleted', 'renamed', 'copied', 'type_changed', 'unmerged'] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** Why a file's diff text was left out: binary, too big for one file, past the response's budget, a symlink, or git gave none. */
export const DIFF_OMITTED = ['binary', 'too_large', 'limit', 'symlink', 'unavailable'] as const;
export type DiffOmitted = (typeof DIFF_OMITTED)[number];

/** How a thread's base commit was picked: where its worktree was cut, or the merge base with the default branch. */
export const BASE_HOWS = ['thread-start', 'merge-base'] as const;
export type BaseHow = (typeof BASE_HOWS)[number];

/** running: under way. capturing: ended, its after snapshot being saved. ready: both saved. failed: `error` says why. */
export const TURN_STATES = ['running', 'capturing', 'ready', 'failed'] as const;
export type TurnState = (typeof TURN_STATES)[number];

export interface ChangedFile {
  path: string;
  /** The path before a rename or copy, else null. */
  old_path: string | null;
  status: ChangeStatus;
  /** Lines added and removed, null when git cannot count them (binary) or the file was too big to read. */
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  /** Set when `diff` is empty on purpose. */
  omitted: DiffOmitted | null;
  /** This file's part of a unified diff, from its `diff --git` line. Empty when omitted. */
  diff: string;
}

export interface ChangeGroup {
  kind: ChangeKind;
  files: ChangedFile[];
  /** More files changed than are listed. */
  truncated: boolean;
}

/** The commit a thread's changes are compared to. */
export interface ChangeBase {
  sha: string;
  /** The branch it was taken from, like `main` or `origin/main`, or `HEAD` when there was none. */
  ref: string;
  how: BaseHow;
  recorded_at: string;
}

export type BranchChanges =
  | { available: false; reason: string }
  | { available: true; cwd: string; branch: string | null; head: string; base: ChangeBase; groups: ChangeGroup[] };

/** One side of a turn: a snapshot commit under a hidden ref, and HEAD when it was taken. */
export interface TurnSide {
  /** The snapshot commit, kept under `ref`. */
  sha: string;
  ref: string;
  /** HEAD at that moment. A different HEAD after means the turn committed, pulled or switched commits. */
  head: string;
}

/** One turn's saved diff, without its files. */
export interface TurnView {
  id: string;
  n: number;
  state: TurnState;
  error: string | null;
  before: TurnSide | null;
  after: TurnSide | null;
  /** The Result the turn ended with, the same id as in Needs you. Null while it runs, or when it left none. */
  completion_uid: string | null;
  started_at: string;
  ended_at: string | null;
}

/** GET /api/threads/:id/turns: the thread's saved turns, newest first, and the diff of one of them. */
export interface TurnChanges {
  /** False when this thread's turns are not saved here; `reason` says why. */
  available: boolean;
  reason: string | null;
  turns: TurnView[];
  /** The turn shown: the one asked for, else the newest. */
  turn: TurnView | null;
  /** Its files, once both snapshots are saved: one `turn` group. */
  groups: ChangeGroup[];
}

// ---------- validation ----------

type Check = (v: unknown, at: string, out: string[]) => void;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const prim =
  (type: 'string' | 'number' | 'boolean'): Check =>
  (v, at, out) => {
    if (typeof v !== type) out.push(`${at}: expected a ${type}`);
  };
const str = prim('string');
const num = prim('number');
const bool = prim('boolean');
const oneOf =
  (values: readonly string[]): Check =>
  (v, at, out) => {
    if (typeof v !== 'string' || !values.includes(v)) out.push(`${at}: expected one of ${values.join(', ')}`);
  };
const nullable =
  (check: Check): Check =>
  (v, at, out) => {
    if (v !== null) check(v, at, out);
  };
const list =
  (check: Check): Check =>
  (v, at, out) => {
    if (!Array.isArray(v)) return void out.push(`${at}: expected a list`);
    v.forEach((x, i) => check(x, `${at}[${i}]`, out));
  };
/** Every key named, with nothing else: a key the server adds or drops shows up here before a client misses it. */
const object =
  (shape: Record<string, Check>): Check =>
  (v, at, out) => {
    if (!isObj(v)) return void out.push(`${at}: expected an object`);
    for (const [k, check] of Object.entries(shape)) {
      if (!(k in v)) out.push(`${at}.${k}: missing`);
      else check(v[k], `${at}.${k}`, out);
    }
    for (const k of Object.keys(v)) if (!(k in shape)) out.push(`${at}.${k}: not in @omni/shared/changes.ts`);
  };

const changedFileShape = {
  path: str,
  old_path: nullable(str),
  status: oneOf(CHANGE_STATUSES),
  additions: nullable(num),
  deletions: nullable(num),
  binary: bool,
  omitted: nullable(oneOf(DIFF_OMITTED)),
  diff: str,
};
const changeGroupShape = { kind: oneOf(CHANGE_KINDS), files: list(object(changedFileShape)), truncated: bool };
const changeBaseShape = { sha: str, ref: str, how: oneOf(BASE_HOWS), recorded_at: str };
const unavailableShape = { available: bool, reason: str };
const availableShape = { available: bool, cwd: str, branch: nullable(str), head: str, base: object(changeBaseShape), groups: list(object(changeGroupShape)) };
const turnSideShape = { sha: str, ref: str, head: str };
const turnViewShape = {
  id: str,
  n: num,
  state: oneOf(TURN_STATES),
  error: nullable(str),
  before: nullable(object(turnSideShape)),
  after: nullable(object(turnSideShape)),
  completion_uid: nullable(str),
  started_at: str,
  ended_at: nullable(str),
};
const turnChangesShape = {
  available: bool,
  reason: nullable(str),
  turns: list(object(turnViewShape)),
  turn: nullable(object(turnViewShape)),
  groups: list(object(changeGroupShape)),
};

const branchChanges: Check = (v, at, out) => object(isObj(v) && v.available === false ? unavailableShape : availableShape)(v, at, out);

/**
 * Each wire type's JSON keys, for checking a client's own copy (the Mac's Changes.swift). `BranchChanges` is both of
 * its forms together, as a client that decodes one struct reads it.
 */
export const CHANGES_WIRE_KEYS: Record<string, string[]> = {
  BranchChanges: [...new Set([...Object.keys(unavailableShape), ...Object.keys(availableShape)])],
  ChangeBase: Object.keys(changeBaseShape),
  ChangeGroup: Object.keys(changeGroupShape),
  ChangedFile: Object.keys(changedFileShape),
  TurnSide: Object.keys(turnSideShape),
  TurnView: Object.keys(turnViewShape),
  TurnChanges: Object.keys(turnChangesShape),
};

const problems = (check: Check) => (v: unknown) => {
  const out: string[] = [];
  check(v, '$', out);
  return out;
};

/** Where a GET /api/threads/:id/changes answer differs from `BranchChanges`. Empty when it matches. */
export const changesProblems = problems(branchChanges);
/** Where a GET /api/threads/:id/turns answer differs from `TurnChanges`. Empty when it matches. */
export const turnChangesProblems = problems(object(turnChangesShape));
