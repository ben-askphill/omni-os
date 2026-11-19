// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_DESKTOP_SETTINGS, type DesktopBridge, type DesktopSettings } from '@omni/shared/desktop-bridge.ts';

// The setup wizard against what has shipped: the Harnesses step reads #757's reasons as text and offers Install only
// for a missing CLI, the copy follows the install (desktop app or checkout) and the layout, and a Notifications step
// asks up front.

let harnesses: unknown[] = [];
let accounts: unknown = { machines: [], synced: false };
/** GET /api/setup/github. Unset stands for an older server without it, which answers 404. */
let github: unknown;
const routes = async (path: string) => {
  if (path === '/setup/github' && github === undefined) throw new Error('Not found');
  return path === '/harnesses' ? harnesses : path === '/accounts' ? accounts : path === '/setup/github' ? github : {};
};
/** POSTs the page sent, and what each answers: Connect GitHub's start and poll, by path. */
let posts: { path: string; body: unknown }[] = [];
let postAnswers: Record<string, unknown[]> = {};
const post = async (path: string, body: unknown) => {
  posts.push({ path, body });
  const queue = postAnswers[path];
  return queue && queue.length > 1 ? queue.shift() : (queue?.[0] ?? {});
};
vi.mock('../src/api.ts', () => ({ api: { get: routes, post, put: async () => ({}) }, errorText: String, ApiError: class extends Error {} }));
afterEach(() => {
  accounts = { machines: [], synced: false };
  github = undefined;
  posts = [];
  postAnswers = {};
});

const { FilesScreen, HarnessScreen, NotificationsScreen, STEPS, WorkScreen } = await import('../src/components/onboarding-parts.tsx');
const { DoneTips, SavedNote, addChannelHint, doneTips, offersNpmSetup } = await import('../src/components/Onboarding.tsx');

let root: Root | null = null;
let host: HTMLElement;
async function render(el: ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(el));
  await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const labels = (row: Element) => [...row.querySelectorAll('span.w-12')].map((s) => s.textContent);
const row = (el: HTMLElement, id: string) => el.querySelector(`[data-harness="${id}"]`)!;

describe('Harnesses step', () => {
  it('signed out, missing and a reason each read as what they are', async () => {
    const noCodex = 'Omni found no codex on its PATH. Install Codex or set OMNI_CODEX_BIN to its path';
    harnesses = [
      { id: 'claude-code', name: 'Claude Code', plan: 'Claude plan', available: true, models: [], running: 0, cap: 4 },
      { id: 'codex', name: 'Codex', plan: 'ChatGPT plan', available: false, missing: true, fix: noCodex, install: 'npm install -g @openai/codex', models: [], running: 0, cap: 2 },
      { id: 'cursor', name: 'Cursor Agent', plan: 'Cursor plan', available: false, fix: 'cursor-agent login', models: [], running: 0, cap: 2 },
      { id: 'hermes', name: 'Hermes', plan: 'Anthropic API via Hermes', available: false, fix: 'Set the Hermes URL', models: [], running: 0, cap: 2 },
    ];
    const el = await render(createElement(HarnessScreen));
    expect([...el.querySelectorAll('[data-harness]')].map((r) => [r.getAttribute('data-harness'), r.getAttribute('data-state')])).toEqual([
      ['claude-code', 'ready'],
      ['codex', 'missing'],
      ['cursor', 'signed-out'],
    ]);
    const codex = row(el, 'codex');
    expect(text(codex)).toContain('Not installed');
    expect(labels(codex)).toEqual(['Install']);
    expect(text(codex)).toContain(`${noCodex}.`);
    expect([...codex.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['npm install -g @openai/codex']);
    const cursor = row(el, 'cursor');
    expect(text(cursor)).toContain('Signed out');
    expect(labels(cursor)).toEqual(['Sign in']);
  });

  it('an error is a sentence with nothing to copy', async () => {
    const exited = 'codex app-server exited (code 1) before it answered. Run codex app-server in a terminal to see why';
    harnesses = [{ id: 'codex', name: 'Codex', plan: 'ChatGPT plan', available: false, fix: exited, models: [], running: 0, cap: 2 }];
    const codex = row(await render(createElement(HarnessScreen)), 'codex');
    expect(codex.getAttribute('data-state')).toBe('error');
    expect(codex.querySelectorAll('code')).toHaveLength(0);
    expect(text(codex)).toContain(`${exited}.`);
  });

  // The Conductor reviews only when asked (crew/conductor.md), so Codex is optional, not a reviewer of every PR.
  it('says Codex is optional and reviews only on request', async () => {
    harnesses = [
      { id: 'claude-code', name: 'Claude Code', plan: 'Claude plan', available: true, models: [], running: 0, cap: 4 },
      { id: 'codex', name: 'Codex', plan: 'ChatGPT plan', available: false, fix: 'codex login', models: [], running: 0, cap: 2 },
    ];
    const el = await render(createElement(HarnessScreen));
    expect(text(el)).toContain('Omni needs Claude Code. Codex and Cursor Agent are optional.');
    expect(text(row(el, 'codex'))).toContain('Optional. Reviews a pull request Claude wrote when you ask the Conductor for a review.');
    expect(text(el)).not.toContain('each time');
    expect(text(el)).toContain('You can add the others any time.');
  });

  it('leaves the GitHub CLI out for someone who does not work with code', async () => {
    harnesses = [{ id: 'claude-code', name: 'Claude Code', plan: 'Claude plan', available: true, models: [], running: 0, cap: 4 }];
    github = { state: 'signed-out' };
    const heard: unknown[] = [];
    const el = await render(createElement(HarnessScreen, { code: false, onGithub: (g) => heard.push(g) }));
    expect(el.querySelector('[data-harness="github"]')).toBeNull();
    expect(heard.at(-1)).toBeNull();
  });
});

describe('Harnesses step: accounts and the GitHub CLI', () => {
  const claude = { id: 'claude-code', name: 'Claude Code', plan: 'Claude plan', available: true, models: [], running: 0, cap: 4 };
  const codex = { id: 'codex', name: 'Codex', plan: 'ChatGPT plan', available: false, fix: 'codex login', models: [], running: 0, cap: 2 };
  const account = (harness: string, state: string, label: string | null, plan: string | null, org: string | null = null) => ({ harness, state, label, plan, org, note: null, switched: null, notice: false });

  it("names the account each ready harness runs as on this machine, not another machine's", async () => {
    harnesses = [claude, codex];
    accounts = {
      synced: true,
      machines: [
        { id: 'm1', name: 'studio', current: true, checkedAt: null, accounts: [account('claude-code', 'signed-in', 'ada@work.com', 'Max', 'Acme'), account('codex', 'signed-out', null, null)] },
        { id: 'm2', name: 'laptop', current: false, checkedAt: null, accounts: [account('claude-code', 'signed-in', 'ada@home.com', 'Pro')] },
      ],
    };
    const el = await render(createElement(HarnessScreen));
    expect(text(row(el, 'claude-code').querySelector('[data-account]'))).toBe('Signed in as ada@work.com · Max (Acme)');
    expect(row(el, 'codex').querySelector('[data-account]')).toBeNull();
    expect(text(el)).not.toContain('ada@home.com');
    expect(text(el)).toContain('Wrong account? Sign in to the right one in a terminal, then Check again. Settings > Accounts lists them later');
  });

  it('no account line, and no "wrong account" note, when no harness reads as signed in', async () => {
    harnesses = [claude];
    const el = await render(createElement(HarnessScreen));
    expect(el.querySelector('[data-account]')).toBeNull();
    expect(text(el)).not.toContain('Wrong account?');
  });

  it('GitHub CLI: ready with its login, signed out with gh auth login, missing with brew', async () => {
    harnesses = [claude];
    github = { state: 'ready', login: 'ada-l' };
    let el = await render(createElement(HarnessScreen));
    let gh = row(el, 'github');
    expect(gh.getAttribute('data-state')).toBe('ready');
    expect(text(gh)).toContain('GitHub CLI');
    expect(text(gh.querySelector('[data-account]'))).toBe('Signed in as ada-l');
    expect(text(el)).toContain('You can add the others any time.');
    act(() => root?.unmount());
    host.remove();

    github = { state: 'signed-out', command: 'gh auth login' };
    el = await render(createElement(HarnessScreen));
    gh = row(el, 'github');
    expect(text(gh)).toContain('Signed out');
    expect(labels(gh)).toEqual(['Sign in']);
    expect([...gh.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['gh auth login']);
    expect(text(el)).toContain('Set up the GitHub CLI before you work on pull requests.');
    act(() => root?.unmount());
    host.remove();

    github = { state: 'missing', install: 'brew install gh', command: 'gh auth login' };
    el = await render(createElement(HarnessScreen));
    gh = row(el, 'github');
    expect(text(gh)).toContain('Not installed');
    expect(labels(gh)).toEqual(['Install', 'Sign in']);
  });

  it('Connect GitHub only when gh is installed and signed out', async () => {
    harnesses = [claude];
    const connect = (el: HTMLElement) => [...row(el, 'github').querySelectorAll('button')].find((b) => text(b) === 'Connect GitHub');
    github = { state: 'signed-out', command: 'gh auth login' };
    let el = await render(createElement(HarnessScreen));
    expect(connect(el)).toBeTruthy();
    // The terminal way stays beside it.
    expect(labels(row(el, 'github'))).toEqual(['Sign in']);
    act(() => root?.unmount());
    host.remove();

    for (const g of [
      { state: 'ready', login: 'ada-l' },
      { state: 'missing', install: 'brew install gh', command: 'gh auth login' },
      { state: 'error', reason: 'Omni could not read gh auth status.' },
    ]) {
      github = g;
      el = await render(createElement(HarnessScreen));
      expect(connect(el)).toBeUndefined();
      act(() => root?.unmount());
      host.remove();
    }
  });

  const start = { flow: 'f1', secret: 's1', userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device', verificationUriComplete: null, interval: 0.01 };
  const wait = (ms = 60) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
  const click = (el: Element, label: string) =>
    act(async () => {
      [...el.querySelectorAll('button')].find((b) => text(b) === label)!.click();
      await new Promise((r) => setTimeout(r, 5));
    });

  it('Connect GitHub: the code with Copy, a link to GitHub, then signed in as the login gh reads', async () => {
    harnesses = [claude];
    github = { state: 'signed-out', command: 'gh auth login' };
    const heard: unknown[] = [];
    postAnswers = { '/setup/github/login': [start], '/setup/github/login/poll': [{ state: 'pending' }, { state: 'signed_in', login: 'ada-l' }] };
    const el = await render(createElement(HarnessScreen, { onGithub: (g) => heard.push(g) }));
    await click(row(el, 'github'), 'Connect GitHub');
    const card = row(el, 'github').querySelector('[data-device-code]')!;
    expect(text(card.querySelector('[aria-label="Sign-in code"]'))).toBe('AB12-CD34');
    expect([...card.querySelectorAll('button')].map(text)).toContain('Copy code');
    const open = card.querySelector('a')!;
    expect([text(open), open.getAttribute('href'), open.getAttribute('target')]).toEqual(['Open GitHub', 'https://github.com/login/device', '_blank']);
    expect(text(card)).toContain('Waiting for approval');

    github = { state: 'ready', login: 'ada-l' };
    await wait();
    const gh = row(el, 'github');
    expect(gh.getAttribute('data-state')).toBe('ready');
    expect(text(gh.querySelector('[data-account]'))).toBe('Signed in as ada-l');
    expect(gh.querySelector('[data-device-code]')).toBeNull();
    expect(posts.filter((p) => p.path === '/setup/github/login/poll').every((p) => JSON.stringify(p.body) === '{"flow":"f1","secret":"s1"}')).toBe(true);
    expect(heard.at(0)).toEqual({ state: 'signed-out', command: 'gh auth login' });
    expect(heard.at(-1)).toEqual({ state: 'ready', login: 'ada-l' });
  });

  it('Cancel tells the server to stop gh and says gh is still signed out; a decline or an expired code says why', async () => {
    harnesses = [claude];
    github = { state: 'signed-out', command: 'gh auth login' };
    postAnswers = { '/setup/github/login': [start], '/setup/github/login/poll': [{ state: 'pending' }] };
    let el = await render(createElement(HarnessScreen));
    await click(row(el, 'github'), 'Connect GitHub');
    await click(row(el, 'github'), 'Cancel');
    expect(posts.find((p) => p.path === '/setup/github/login/cancel')?.body).toEqual({ flow: 'f1', secret: 's1' });
    expect(row(el, 'github').querySelector('[data-device-code]')).toBeNull();
    expect(text(row(el, 'github').querySelector('[data-cancelled]'))).toBe('Cancelled. gh is still signed out.');
    expect(row(el, 'github').getAttribute('data-state')).toBe('signed-out');
    act(() => root?.unmount());
    host.remove();

    for (const [answer, words] of [
      [{ state: 'denied' }, 'Sign-in was declined on GitHub.'],
      [{ state: 'expired' }, 'The code expired before it was entered. Connect again.'],
      [{ state: 'refused', error: 'Cancelled.' }, 'Cancelled.'],
    ] as const) {
      postAnswers = { '/setup/github/login': [start], '/setup/github/login/poll': [answer] };
      el = await render(createElement(HarnessScreen));
      await click(row(el, 'github'), 'Connect GitHub');
      await wait();
      expect(text(row(el, 'github'))).toContain(words);
      expect([...row(el, 'github').querySelectorAll('button')].map(text)).toContain('Connect GitHub');
      act(() => root?.unmount());
      host.remove();
    }
  });

  it('an older server without the gh check shows no GitHub row', async () => {
    harnesses = [claude];
    const el = await render(createElement(HarnessScreen));
    expect(el.querySelector('[data-harness="github"]')).toBeNull();
    expect(el.querySelector('[data-harness="claude-code"]')).not.toBeNull();
  });
});

describe('Done screen: what to set up next', () => {
  const ids = (tips: { id: string }[]) => tips.map((t) => t.id);

  it('every layout points at the iPhone app and a second machine', () => {
    for (const where of ['rail', 'classic', 'phone'] as const) {
      const tips = doneTips('app', where);
      expect(tips.find((t) => t.id === 'phone')!.text).toBe('Add your iPhone: make a pairing code in Settings > Sharing & access > Omni for iOS.');
      expect(tips.find((t) => t.id === 'machine')!.text).toBe('Run threads on a second machine: turn on Settings > Sync on both, then pick one with Run on.');
    }
  });

  it('the omni command: on PATH in the desktop app, scripts/omni.sh in a checkout, none on a phone', () => {
    expect(doneTips('app', 'rail').find((t) => t.id === 'cli')!.code).toBe('omni new "…"  ·  omni doctor');
    expect(doneTips('app', 'classic').find((t) => t.id === 'cli')!.code).toBe('omni new "…"  ·  omni doctor');
    expect(doneTips('checkout', 'rail').find((t) => t.id === 'cli')!.code).toBe('scripts/omni.sh new "…"  ·  scripts/omni.sh doctor');
    expect(ids(doneTips('app', 'phone'))).toEqual(['phone', 'machine']);
    expect(ids(doneTips('checkout', 'phone'))).toEqual(['phone', 'machine']);
  });

  it('renders each tip with its command as code', async () => {
    const el = await render(createElement(DoneTips, { tips: doneTips('app', 'rail') }));
    expect([...el.querySelectorAll('[data-tip]')].map((t) => t.getAttribute('data-tip'))).toEqual(['phone', 'machine', 'cli']);
    expect(text(el.querySelector('[data-tip="cli"] code'))).toBe('omni new "…" · omni doctor');
  });
});

describe('copy for the install and the layout', () => {
  it('offers npm run setup only for a checkout seen outside the desktop app', () => {
    expect(offersNpmSetup('checkout', false)).toBe(true);
    expect(offersNpmSetup('checkout', true)).toBe(false);
    expect(offersNpmSetup('app', false)).toBe(false);
  });

  it('the Done note: a checkout gets npm run setup, the desktop app does not', async () => {
    let el = await render(createElement(SavedNote, { path: '~/omni-os/data/omni.config.json', install: 'checkout' }));
    expect(text(el)).toBe('Saved in ~/omni-os/data/omni.config.json, which stays out of git. Change it any time in Settings, or run npm run setup.');
    act(() => root?.unmount());
    host.remove();
    el = await render(createElement(SavedNote, { path: '~/Library/Application Support/Omni/data/omni.config.json', install: 'app' }));
    expect(text(el)).toBe('Saved in ~/Library/Application Support/Omni/data/omni.config.json. Change it any time in Settings.');
    expect(text(el)).not.toContain('npm run setup');
  });

  it('names where to add a channel later on each layout', () => {
    expect(addChannelHint('rail')).toBe('Skip it and add projects later with Add channel (+) at the foot of the rail.');
    expect(addChannelHint('classic')).toBe('Skip it and add projects later with Add channel in the sidebar.');
    expect(addChannelHint('phone')).toBe('Skip it and add projects later in Settings > Channels.');
  });
});

describe('Notifications step', () => {
  it('sits before Done', () => {
    expect(STEPS).toEqual(['You', 'Work', 'Files', 'Harnesses', 'Project', 'Notifications', 'Done']);
  });

  it('in the desktop app: a test notification so macOS asks now, and the switch saves the app setting', async () => {
    let settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
    const calls: string[] = [];
    const bridge = {
      platform: 'darwin',
      nativeNotifications: true,
      testNotification: async () => (calls.push('test'), true),
      settings: {
        get: async () => settings,
        set: async (patch: { notifications?: { enabled?: boolean } }) => {
          calls.push(`set:${patch.notifications?.enabled}`);
          settings = { ...settings, notifications: { ...settings.notifications, enabled: patch.notifications?.enabled ?? true } };
          return settings;
        },
      },
    } as unknown as DesktopBridge;
    const el = await render(createElement(NotificationsScreen, { bridge }));
    expect(text(el)).toContain('macOS asks once whether Omni may; send a test now so it asks here, not mid-task.');
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Send a test notification'))!;
    await act(async () => button.click());
    expect(calls).toEqual(['test']);
    expect(text(el.querySelector('[data-sent]'))).toBe('Sent. If nothing showed, allow Omni in System Settings > Notifications > Omni.');
    await act(async () => (el.querySelector('[role="switch"]') as HTMLButtonElement).click());
    expect(calls).toEqual(['test', 'set:false']);
    expect(el.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('in a browser that can notify: the switch asks the browser', async () => {
    const asked = vi.fn(async () => 'granted' as NotificationPermission);
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission: asked }));
    try {
      const el = await render(createElement(NotificationsScreen, { bridge: null }));
      expect(text(el.querySelector('[data-permission]'))).toBe('Not asked yet');
      await act(async () => (el.querySelector('[role="switch"]') as HTMLButtonElement).click());
      expect(asked).toHaveBeenCalledOnce();
      expect(el.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('in a browser without notifications, such as Safari on an iPhone: points at the iPhone app', async () => {
    const keep = (globalThis as { Notification?: unknown }).Notification;
    delete (globalThis as { Notification?: unknown }).Notification;
    try {
      const el = await render(createElement(NotificationsScreen, { bridge: null }));
      expect(text(el.querySelector('[data-permission]'))).toBe('Not supported in this browser');
      expect(el.querySelector('[role="switch"]')!.hasAttribute('disabled')).toBe(true);
      expect(text(el)).toContain('On an iPhone, the Omni app sends push alerts instead. Pair it from Settings > Sharing & access.');
    } finally {
      if (keep) (globalThis as { Notification?: unknown }).Notification = keep;
    }
  });
});

describe('Work step: what you do and which tools', () => {
  const chips = (el: Element) => [...el.querySelectorAll('[aria-label="Tools you use"] button')];
  const pressed = (el: Element) => chips(el).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

  it('asks in plain words, with the tools as chips and an Others field', async () => {
    const el = await render(createElement(WorkScreen, { work: '', tools: 'Email, Xero', onWork: () => {}, onTools: () => {} }));
    expect(text(el.querySelector('h2'))).toBe('What do you do?');
    expect(chips(el).map((b) => b.textContent)).toEqual(['Email', 'Calendar', 'Google Drive', 'Notion', 'Slack', 'Linear', 'Jira', 'Figma', 'GitHub and code', 'Shopify']);
    expect(pressed(el)).toEqual(['Email']);
    expect((el.querySelector('#ob-tools-other') as HTMLInputElement).value).toBe('Xero');
  });

  it('a chip adds its tool to the line and keeps what was typed under Others', async () => {
    let tools = 'Email, Xero';
    const el = await render(createElement(WorkScreen, { work: '', tools, onWork: () => {}, onTools: (v: string) => (tools = v) }));
    await act(async () => (chips(el).find((b) => b.textContent === 'Notion') as HTMLButtonElement).click());
    expect(tools).toBe('Email, Notion, Xero');
  });
});

describe('Files step: where Omni keeps your files', () => {
  const fallbacks = { workspaceRoot: '/home/ada/Omni', reposDir: '/home/ada/code' };
  const value = { root: '', reposDir: '', githubOwner: '' };

  it('asks for one folder, with code as an add-on that starts closed', async () => {
    const el = await render(createElement(FilesScreen, { value, onChange: () => {}, code: false, onCode: () => {}, fallbacks }));
    expect(text(el.querySelector('h2'))).toBe('Where should Omni keep your files?');
    expect(el.querySelector('#ob-root')).not.toBeNull();
    expect(el.querySelector('#ob-repos')).toBeNull();
    expect(el.querySelector('#ob-gh')).toBeNull();
    expect(text(el.querySelector('[data-addon="code"]'))).toContain('I work with code');
  });

  it('with the add-on on, shows the repos folder and GitHub owner', async () => {
    const el = await render(createElement(FilesScreen, { value, onChange: () => {}, code: true, onCode: () => {}, fallbacks }));
    expect(el.querySelector('#ob-repos')).not.toBeNull();
    expect(el.querySelector('#ob-gh')).not.toBeNull();
  });
});
