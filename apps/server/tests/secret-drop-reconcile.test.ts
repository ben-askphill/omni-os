import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { waitFor } from './support.ts';

// The receiving side of set_secret on one machine. Drops go straight into kv as the sender's sync would bring them,
// and the secret store's write is a fake that can be held open, so a test sees exactly when reconcileSecretDrops
// writes and how many writes overlap. No Keychain and no real secrets: every value is a placeholder, and the fake
// records accounts (scope/name) only.

const h = await startRunner({ OMNI_SECRET_STORE: 'file' });
const { kv } = await import('../db.ts');
const { secretStore } = await import('../secret-store.ts');
const { changesHowProgramsStart, checkSecret, reconcileSecretDrops, seal, sealPublicKey } = await import('../secret-drop.ts');

const SELF = 'box-b';
const PLACEHOLDER = 'placeholder-value-not-a-secret';
let publicKey = '';

/** Store writes in flight right now, and the most there ever were at once. */
let active = 0;
let mostAtOnce = 0;
/** Accounts the fake store saved, in order. Never values. */
let saved: string[] = [];
/** While set, every store write waits for it. */
let hold: Promise<void> | null = null;
/** While set, every store write fails with it. */
let failWith: Error | null = null;

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
};

let n = 0;
/** A drop for this machine, sealed to its key, as the sender's sync would bring it. */
function drop(name: string, scope = 'global'): string {
  const id = `drop-${++n}`;
  const meta = { id, sender: 'mac-a', target: SELF, scope, name };
  const at = Date.now();
  kv.set(`secretdrop.${id}`, {
    ...meta,
    target_name: 'Box B',
    sealed: seal(PLACEHOLDER, publicKey, meta),
    at: new Date(at).toISOString(),
    expires_at: new Date(at + 60 * 60_000).toISOString(),
  });
  return id;
}
const ackOf = (id: string) => kv.get<{ state: string; reason: string | null }>(`secretack.${id}`);
const passes = (list: { mock: { calls: unknown[][] } }) => list.mock.calls.filter(([prefix]) => prefix === 'secretdrop.').length;
const inStore = () => waitFor(() => active === 1, 'a pass to reach the store write');

beforeAll(async () => {
  h.db.outbox.arm(SELF);
  // Makes this machine's seal key with the real (file) store, before the fake replaces its writes.
  publicKey = await sealPublicKey();
});

afterEach(() => {
  vi.restoreAllMocks();
  active = mostAtOnce = 0;
  saved = [];
  hold = failWith = null;
});

function fakeStore() {
  vi.spyOn(secretStore(), 'write').mockImplementation(async (account) => {
    active++;
    mostAtOnce = Math.max(mostAtOnce, active);
    try {
      await (hold ?? new Promise((resolve) => setTimeout(resolve, 5)));
      if (failWith) throw failWith;
      saved.push(account);
    } finally {
      active--;
    }
  });
}

describe('taking sent secrets, one pass at a time', () => {
  it('never has two passes in the store write at once, and saves each drop once', async () => {
    fakeStore();
    const ids = ['ONE_KEY', 'TWO_KEY', 'THREE_KEY'].map((name) => drop(name));
    await Promise.all([reconcileSecretDrops(), reconcileSecretDrops(), reconcileSecretDrops(), reconcileSecretDrops()]);
    expect(mostAtOnce).toBe(1);
    expect([...saved].sort()).toEqual(['global/ONE_KEY', 'global/THREE_KEY', 'global/TWO_KEY']);
    for (const id of ids) expect(ackOf(id)).toMatchObject({ state: 'accepted', reason: null });
  });

  it('runs one more pass after a busy one, however many calls came, and it takes a drop that synced meanwhile', async () => {
    fakeStore();
    const list = vi.spyOn(kv, 'list');
    const g = gate();
    hold = g.opened;
    const early = drop('EARLY_KEY');
    const running = reconcileSecretDrops();
    await inStore();
    // Synced after the busy pass listed the drops, so only a later pass can see it.
    const late = drop('LATE_KEY');
    const queued = [reconcileSecretDrops(), reconcileSecretDrops(), reconcileSecretDrops()];
    hold = null;
    g.open();
    await Promise.all([running, ...queued]);
    expect(ackOf(early)).toMatchObject({ state: 'accepted' });
    expect(ackOf(late)).toMatchObject({ state: 'accepted' });
    expect(saved).toEqual(['global/EARLY_KEY', 'global/LATE_KEY']);
    expect(mostAtOnce).toBe(1);
    // Three calls during the busy pass made one more pass, not three.
    expect(passes(list)).toBe(2);
  });

  it('a pass that throws rejects its caller and frees the lock for the next call', async () => {
    fakeStore();
    const realList = kv.list;
    let thrown = false;
    vi.spyOn(kv, 'list').mockImplementation(((prefix: string) => {
      if (prefix === 'secretdrop.' && !thrown) {
        thrown = true;
        throw new Error('fake db failure');
      }
      return realList(prefix);
    }) as typeof kv.list);
    await expect(reconcileSecretDrops()).rejects.toThrow('fake db failure');
    const id = drop('AFTER_FAILURE_KEY');
    await reconcileSecretDrops();
    expect(ackOf(id)).toMatchObject({ state: 'accepted' });
  });

  it('a pass that throws still runs the pass queued behind it, and the log names no value', async () => {
    fakeStore();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = drop('RETRIED_KEY');
    // The busy pass saves the value but cannot record its answer.
    const realSet = kv.set;
    let thrown = false;
    vi.spyOn(kv, 'set').mockImplementation(((key: string, value: unknown) => {
      if (key === `secretack.${id}` && !thrown) {
        thrown = true;
        throw new Error('fake db failure');
      }
      return realSet(key, value);
    }) as typeof kv.set);
    const g = gate();
    hold = g.opened;
    const running = reconcileSecretDrops();
    await inStore();
    const queued = reconcileSecretDrops();
    hold = null;
    g.open();
    await Promise.all([running, queued]);
    expect(ackOf(id)).toMatchObject({ state: 'accepted' });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('[secrets]'), 'fake db failure');
    expect(JSON.stringify(errors.mock.calls)).not.toContain(PLACEHOLDER);
  });

  it('never replaces an answer already given, so a late refusal cannot undo an accepted secret', async () => {
    fakeStore();
    const id = drop('RACED_KEY');
    const g = gate();
    hold = g.opened;
    failWith = new Error('fake store: the item already exists (-25299)');
    const running = reconcileSecretDrops();
    await inStore();
    // Another writer answered while this pass was inside the store.
    kv.set(`secretack.${id}`, { state: 'accepted', reason: null, at: new Date().toISOString() });
    hold = null;
    g.open();
    await running;
    expect(ackOf(id)).toMatchObject({ state: 'accepted', reason: null });
  });
});

describe('names that change how programs start', () => {
  const CORE = ['PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH'];
  // The rest of the family from the guard's first version (2bc34f2e): interpreter and loader settings, git and npm
  // settings, the shell's startup files, and where TLS trust and proxies come from. Then where the harness CLIs send
  // their requests (with the login) and read their config, and a few more that run a command.
  const FAMILY = ['NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'PYTHONPATH', 'PYTHONSTARTUP', 'PERL5OPT', 'RUBYOPT', 'JAVA_TOOL_OPTIONS', 'GIT_SSH_COMMAND', 'GIT_CONFIG_COUNT', 'NPM_CONFIG_SCRIPT_SHELL', 'BASH_ENV', 'ENV', 'HOME', 'SSL_CERT_FILE', 'HTTPS_PROXY'];
  const HARNESS = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_BEDROCK_BASE_URL',
    'ANTHROPIC_VERTEX_BASE_URL',
    'OPENAI_BASE_URL',
    'OPENAI_API_BASE',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_ENV_FILE',
    'CLAUDE_CODE_SHELL_PREFIX',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CODEX_HOME',
    'CURSOR_CONFIG_DIR',
    'XDG_CONFIG_HOME',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'LESSOPEN',
    'LESSCLOSE',
    'PROMPT_COMMAND',
  ];
  const ORDINARY = [
    'PATHS',
    'MY_PATH',
    'PATH_PREFIX',
    'LDAP_URL',
    'LD',
    'DYLD',
    'DYLDX',
    'MY_LD_PRELOAD',
    'NODE_OPTIONSX',
    'NODE_OPTIONS_FILE',
    'NODE_AUTH_TOKEN',
    'NODE_ENV',
    'GITHUB_TOKEN',
    'GITLAB_TOKEN',
    'RUBYGEMS_API_KEY',
    'PYTHON_VERSION',
    'NPM_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_URL_NOTE',
    'CLAUDE_CONFIG',
    'XDG_CACHE_HOME',
    'CURSOR_API_KEY',
    'CLAUDE_CODEX',
    'ANTHROPIC_API_KEY',
  ];

  it.each([...CORE, ...FAMILY, ...HARNESS])('refuses %s on every set_secret path', (name) => {
    expect(changesHowProgramsStart(name)).toBe(true);
    expect(() => checkSecret('global', name, PLACEHOLDER)).toThrow(expect.objectContaining({ status: 403, message: `${name} changes how every thread's programs start, so only Settings can set it.` }));
    expect(() => checkSecret('channel:shop', name, PLACEHOLDER)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it.each(ORDINARY)('takes %s as an ordinary secret', (name) => {
    expect(changesHowProgramsStart(name)).toBe(false);
    expect(() => checkSecret('global', name, PLACEHOLDER)).not.toThrow();
  });

  it('matches environment names as spelled, so other cases are not these names (and are not valid names at all)', () => {
    for (const name of ['path', 'Path', 'node_options', 'ld_preload', 'dyld_insert_libraries']) {
      expect(changesHowProgramsStart(name)).toBe(false);
      expect(() => checkSecret('global', name, PLACEHOLDER)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  it('the receiving machine refuses one even when its seal opens, and never writes it to the store', async () => {
    fakeStore();
    const refused = ['PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'GIT_SSH_COMMAND'].map((name) => [name, drop(name)] as const);
    const fine = ['LDAP_URL', 'DYLDX', 'PATHS', 'MY_PATH'].map((name) => [name, drop(name)] as const);
    await reconcileSecretDrops();
    for (const [name, id] of refused) {
      expect(ackOf(id), name).toMatchObject({ state: 'rejected', reason: `${name} changes how every thread's programs start, so only Settings can set it.` });
    }
    for (const [name, id] of fine) expect(ackOf(id), name).toMatchObject({ state: 'accepted', reason: null });
    expect([...saved].sort()).toEqual(['global/DYLDX', 'global/LDAP_URL', 'global/MY_PATH', 'global/PATHS']);
  });
});
