#!/usr/bin/env node
// Checks a QA state dir before a script reads or runs anything in it. The QA scripts keep PID files, logs, the API
// token and the bin/ that goes first on the server's PATH there, and the default sits in a shared temp dir, so the dir
// must be this user's alone: a real directory (not a link), owned by this user and writable by no one else, in folders
// no other user can rename it out of.
//
//   node scripts/qa-private-dir.mjs [--create] DIR
//     prints DIR's real path, the one to use from then on, and exits 0 when it is private. Exits 3 (and prints the
//     path) when DIR does not exist; --create makes it with mode 0700 instead. A DIR of this user's that others can read
//     but not write is closed to 0700. Anything else exits 1 and says why.
import { chmodSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Checks `dir` (made first with `create`). `path` is its real path: the parent as the file system resolves it, links
 * and `..` included, so the caller reads the same dir this checked. `missing` is true when it does not exist.
 */
export function checkPrivateDir(dir, { create = false } = {}) {
  // The shell's $(...) drops a trailing line break, so it would read another dir than the one checked here.
  if (/[\x00-\x1f\x7f]/.test(dir)) return { path: dir, missing: false, problem: 'the state dir path holds a line break or another control character' };
  const leaf = basename(dir);
  if (leaf === '.' || leaf === '..') return { path: dir, missing: false, problem: `${dir} must name the dir itself, not . or ..` };
  // Not path.resolve on the whole path: that drops `link/..` on paper, while the shell follows the link first.
  const rawParent = dirname(dir);
  if (create) mkdirSync(rawParent, { recursive: true });
  let parent;
  try {
    // The native one is libc realpath(3). fs.realpathSync resolves the path on paper first, and so drops `link/..` too.
    parent = realpathSync.native(rawParent);
  } catch (e) {
    if (e?.code === 'ENOENT') return { path: resolve(dir), missing: true, problem: null };
    throw e;
  }
  const path = leaf ? join(parent, leaf) : parent;
  const unsafe = unsafeAncestor(parent);
  if (unsafe) return { path, missing: false, problem: unsafe };

  let st = lstatOrNull(path);
  if (!st && create) {
    try {
      // Not recursive: a dir that exists, or one made in the meantime, fails here and is checked below.
      mkdirSync(path, { mode: 0o700 });
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
    }
    st = lstatOrNull(path);
  }
  if (!st) return { path, missing: true, problem: null };
  if (st.isSymbolicLink()) return { path, missing: false, problem: `${path} is a symlink; remove it, the QA scripts make their own dir` };
  if (!st.isDirectory()) return { path, missing: false, problem: `${path} is not a directory` };
  const uid = process.getuid();
  if (st.uid !== uid) return { path, missing: false, problem: `${path} is owned by uid ${st.uid}, not ${uid}; another user may have made it. Remove it or pick another dir` };
  if (st.mode & 0o022) return { path, missing: false, problem: `${path} is a dir group or others can write; remove it, or chmod 700 it if you made it` };
  if (st.mode & 0o077) chmodSync(path, 0o700);
  return { path, missing: false, problem: null };
}

/**
 * Why another user could swap the dir out from under `realDir` (a path with no links left in it), or null. Every folder
 * from it up to `/` must belong to this user or root, and one that others can write needs the sticky bit, as /tmp has.
 */
function unsafeAncestor(realDir) {
  const uid = process.getuid();
  for (let d = realDir; ; d = dirname(d)) {
    const st = statSync(d);
    if (st.uid !== uid && st.uid !== 0) return `${d}, a folder above the state dir, belongs to uid ${st.uid}; pick a dir under your own or a shared sticky one like /tmp`;
    if (st.mode & 0o022 && !(st.mode & 0o1000)) return `${d}, a folder above the state dir, is one others can write without the sticky bit; pick another dir`;
    if (d === dirname(d)) return null;
  }
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

// Real paths on both sides: run from a checkout reached through a link, argv keeps the link and import.meta.url does not.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const create = args[0] === '--create';
  const dir = create ? args[1] : args[0];
  if (!dir) {
    console.error('usage: qa-private-dir.mjs [--create] DIR');
    process.exit(2);
  }
  const { path, missing, problem } = checkPrivateDir(dir, { create });
  if (problem) {
    console.error(`qa state dir: ${problem}`);
    process.exit(1);
  }
  console.log(path);
  process.exit(missing ? 3 : 0);
}
