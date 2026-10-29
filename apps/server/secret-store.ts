// Where secret values live, per platform. secrets.ts keeps the names in the db and calls one of these for values.
// keychain: the macOS Keychain through `security`. libsecret: the Secret Service (GNOME Keyring, KWallet) through
// `secret-tool`. file: `secrets.json` in the data dir, mode 0600, for a Linux box with no desktop session to unlock
// a keyring. Each install keeps its own: values never sync. No db import, so scripts can read values without
// migrating the database.
import { execFile, spawn } from 'node:child_process';
import { chmodSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SECRET_STORES, type SecretStoreKind } from '@omni/shared/secret-store.ts';
import { paths } from './config.ts';

/** Values by account, which is `scope/name`. */
export interface SecretStore {
  kind: SecretStoreKind;
  read(account: string): Promise<string | null>;
  write(account: string, value: string): Promise<void>;
  remove(account: string): Promise<void>;
}

/** The keychain service and the libsecret `service` attribute. */
export const SERVICE = 'omni-os';
const run = promisify(execFile);

/** Runs `cmd args`, writing `input` to its stdin so a value never shows up in `ps`. Fails on a non-zero exit or any stderr. */
function piped(cmd: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 && !err.trim() ? resolve() : reject(new Error(err.trim() || `${cmd} exited ${code}`))));
    child.stdin.end(input);
  });
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export const keychainStore: SecretStore = {
  kind: 'keychain',
  async read(account) {
    try {
      const { stdout } = await run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
      return stdout.replace(/\n$/, '');
    } catch {
      return null;
    }
  },
  // `security -i` reads the command from stdin.
  write: (account, value) => piped('security', ['-i'], `add-generic-password -U -s ${SERVICE} -a ${quote(account)} -w ${quote(value)}\n`),
  async remove(account) {
    await run('security', ['delete-generic-password', '-s', SERVICE, '-a', account]).catch(() => {});
  },
};

export const libsecretStore: SecretStore = {
  kind: 'libsecret',
  async read(account) {
    try {
      const { stdout } = await run('secret-tool', ['lookup', 'service', SERVICE, 'account', account]);
      return stdout ? stdout.replace(/\n$/, '') : null;
    } catch {
      return null;
    }
  },
  // `secret-tool store` reads the value from stdin.
  write: (account, value) => piped('secret-tool', ['store', `--label=${SERVICE} ${account}`, 'service', SERVICE, 'account', account], value),
  async remove(account) {
    await run('secret-tool', ['clear', 'service', SERVICE, 'account', account]).catch(() => {});
  },
};

/**
 * Values in one JSON object at `file`, written whole to a temp file and renamed over it, mode 0600. A file other
 * accounts can read is tightened before it is read. The same reasoning as api-token.ts: the mode admits only the
 * account the server runs as, which is all a keyring would guard it from on a headless box.
 */
export function fileStore(file: string): SecretStore {
  const load = (): Record<string, string> => {
    try {
      if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  };
  const save = (values: Record<string, string>) => {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  };
  return {
    kind: 'file',
    async read(account) {
      const v = load()[account];
      return typeof v === 'string' ? v : null;
    },
    // Read and write in one synchronous step, so two writes in this process never lose each other.
    async write(account, value) {
      save({ ...load(), [account]: value });
    },
    async remove(account) {
      const values = load();
      if (!(account in values)) return;
      delete values[account];
      save(values);
    },
  };
}

export const secretsFile = () => join(paths.data, 'secrets.json');

/**
 * The store for this platform: the Keychain on macOS, the file anywhere else. OMNI_SECRET_STORE picks one. libsecret
 * is never picked on its own: whether a keyring answers depends on how the server was started (a desktop login, ssh,
 * systemd), and a store that flips between starts hides every value saved in the other.
 */
export function pickSecretStore(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): SecretStoreKind {
  const asked = env.OMNI_SECRET_STORE?.trim().toLowerCase();
  if (asked) {
    if ((SECRET_STORES as readonly string[]).includes(asked)) return asked as SecretStoreKind;
    console.warn(`[omni] OMNI_SECRET_STORE=${asked} is not one of ${SECRET_STORES.join(', ')}; using the platform default`);
  }
  return platform === 'darwin' ? 'keychain' : 'file';
}

export function secretStoreOf(kind: SecretStoreKind): SecretStore {
  return kind === 'keychain' ? keychainStore : kind === 'libsecret' ? libsecretStore : fileStore(secretsFile());
}

let current: SecretStore | null = null;

/** This server's store, picked once. */
export function secretStore(): SecretStore {
  return (current ??= secretStoreOf(pickSecretStore()));
}
