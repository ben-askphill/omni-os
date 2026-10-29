import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSecretStore, fileStore, libsecretStore, pickSecretStore } from '../secret-store.ts';

describe('pickSecretStore', () => {
  it('uses the Keychain on a Mac and the file everywhere else', () => {
    expect(pickSecretStore('darwin', {})).toBe('keychain');
    expect(pickSecretStore('linux', {})).toBe('file');
    expect(pickSecretStore('win32', {})).toBe('file');
  });

  it('takes OMNI_SECRET_STORE over the platform, in any case', () => {
    expect(pickSecretStore('linux', { OMNI_SECRET_STORE: 'libsecret' })).toBe('libsecret');
    expect(pickSecretStore('darwin', { OMNI_SECRET_STORE: ' FILE ' })).toBe('file');
  });

  it('warns about an unknown store and falls back to the platform default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(pickSecretStore('linux', { OMNI_SECRET_STORE: 'vault' })).toBe('file');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('fileStore', () => {
  let file: string;
  beforeEach(() => {
    file = join(mkdtempSync(join(tmpdir(), 'omni-secrets-')), 'secrets.json');
  });

  it('reads nothing before the file exists', async () => {
    expect(await fileStore(file).read('global/GITHUB_TOKEN')).toBeNull();
  });

  it('writes, overwrites and removes values by account, mode 0600', async () => {
    const store = fileStore(file);
    await store.write('global/GITHUB_TOKEN', 'one');
    await store.write('channel:omni-os/GITHUB_TOKEN', 'two');
    await store.write('global/GITHUB_TOKEN', 'three');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await store.read('global/GITHUB_TOKEN')).toBe('three');
    expect(await store.read('channel:omni-os/GITHUB_TOKEN')).toBe('two');

    await store.remove('global/GITHUB_TOKEN');
    expect(await store.read('global/GITHUB_TOKEN')).toBeNull();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'channel:omni-os/GITHUB_TOKEN': 'two' });
    await store.remove('global/NEVER_SET');
  });

  it('keeps a value with quotes, backslashes and spaces as it was', async () => {
    const value = `a "quoted" \\ value with spaces`;
    await fileStore(file).write('global/ODD', value);
    expect(await fileStore(file).read('global/ODD')).toBe(value);
  });

  it('tightens a file other accounts can read before reading it', async () => {
    writeFileSync(file, JSON.stringify({ 'global/A': 'x' }));
    chmodSync(file, 0o644);
    expect(await fileStore(file).read('global/A')).toBe('x');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('libsecretStore', () => {
  const path = process.env.PATH;
  let dir: string;
  let log: string;

  // A secret-tool that keeps each account in its own file and logs its arguments, so a test sees the value never
  // went on the command line.
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'omni-secret-tool-'));
    log = join(dir, 'args.log');
    const fake = join(dir, 'secret-tool');
    writeFileSync(
      fake,
      `#!/bin/sh
echo "$*" >> "${log}"
cmd=$1; shift
for last; do :; done
f="${dir}/$(printf %s "$last" | tr '/:' '__')"
case $cmd in
  store) cat > "$f" ;;
  lookup) [ -f "$f" ] && cat "$f" || exit 1 ;;
  clear) rm -f "$f" ;;
esac
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${dir}${delimiter}${path ?? ''}`;
  });
  afterEach(() => {
    process.env.PATH = path;
  });

  it('stores through stdin, looks up and clears by the omni-os service and account', async () => {
    await libsecretStore.write('global/SUPABASE_URL', 'https://relay.example');
    expect(await libsecretStore.read('global/SUPABASE_URL')).toBe('https://relay.example');
    await libsecretStore.remove('global/SUPABASE_URL');
    expect(await libsecretStore.read('global/SUPABASE_URL')).toBeNull();

    const calls = readFileSync(log, 'utf8');
    expect(calls).toContain('store --label=omni-os global/SUPABASE_URL service omni-os account global/SUPABASE_URL');
    expect(calls).toContain('lookup service omni-os account global/SUPABASE_URL');
    expect(calls).toContain('clear service omni-os account global/SUPABASE_URL');
    expect(calls).not.toContain('relay.example');
  });

  it('passes its boot check when a lookup finds nothing and says nothing', async () => {
    expect(await libsecretStore.check!()).toBeNull();
  });

  it('says to install secret-tool when it is missing, on write and at boot', async () => {
    process.env.PATH = dir.replace(/[^/]+$/, 'nowhere');
    await expect(libsecretStore.write('global/A', 'x')).rejects.toThrow(/secret-tool is not installed/);
    expect(await libsecretStore.read('global/A')).toBeNull();
    expect(await libsecretStore.check!()).toMatch(/libsecret-tools/);
  });

  it('names the missing Secret Service and the way out when no keyring answers', async () => {
    writeFileSync(join(dir, 'secret-tool'), '#!/bin/sh\necho "Cannot autolaunch D-Bus without X11 $DISPLAY" >&2\nexit 1\n', { mode: 0o755 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const problem = await checkSecretStore(libsecretStore);
    expect(problem).toMatch(/Secret Service did not answer \(Cannot autolaunch D-Bus/);
    expect(problem).toMatch(/OMNI_SECRET_STORE=file/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[omni] secret store libsecret:'));
    warn.mockRestore();
    await expect(libsecretStore.write('global/A', 'x')).rejects.toThrow(/Secret Service did not answer/);
  });
});

describe('checkSecretStore', () => {
  it('stays quiet for a store with nothing to check', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await checkSecretStore(fileStore(join(mkdtempSync(join(tmpdir(), 'omni-secrets-')), 'secrets.json')))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
