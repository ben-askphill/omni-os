#!/usr/bin/env node
// Checks a QA state dir before a script reads or runs anything in it. The QA scripts keep PID files, logs, the API
// token and the bin/ that goes first on the server's PATH there, and the default sits in a shared temp dir, so the dir
// must be this user's alone: a real directory (not a link), owned by this user, and writable by no one else.
//
//   node scripts/qa-private-dir.mjs [--create] DIR
//     exits 0 when DIR is private, or missing (nothing to read yet). --create makes a missing DIR with mode 0700.
//     A DIR of this user's that others can read but not write is closed to 0700. Anything else exits 1 and says why.
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Null when `dir` is fit to use (made first with `create`), else why not. */
export function privateDirProblem(dir, { create = false } = {}) {
  const path = resolve(dir);
  let st = lstatOrNull(path);
  if (!st) {
    if (!create) return null;
    mkdirSync(dirname(path), { recursive: true });
    try {
      // Not recursive: an existing dir, or one made in the meantime, fails here and is checked below.
      mkdirSync(path, { mode: 0o700 });
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
    }
    st = lstatOrNull(path);
    if (!st) return `${path} could not be made`;
  }
  if (st.isSymbolicLink()) return `${path} is a symlink; remove it, the QA scripts make their own dir`;
  if (!st.isDirectory()) return `${path} is not a directory`;
  const uid = process.getuid();
  if (st.uid !== uid) return `${path} is owned by uid ${st.uid}, not ${uid}; another user may have made it. Remove it or pick another dir`;
  if (st.mode & 0o022) return `${path} is a dir group or others can write; remove it, or chmod 700 it if you made it`;
  if (st.mode & 0o077) chmodSync(path, 0o700);
  return null;
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const create = args[0] === '--create';
  const dir = create ? args[1] : args[0];
  if (!dir) {
    console.error('usage: qa-private-dir.mjs [--create] DIR');
    process.exit(2);
  }
  const problem = privateDirProblem(dir, { create });
  if (problem) {
    console.error(`qa state dir: ${problem}`);
    process.exit(1);
  }
}
