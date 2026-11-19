// The pieces the onboarding wizard (Onboarding.tsx) is built from: the screen frame, the form row, the step dots, the
// Work and Files questions, the harness check, and the timezone and pronoun fields Settings reuses.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DesktopBridge } from '@omni/shared/desktop-bridge.ts';
import { githubLine, type GhLoginStart, type GithubCheck } from '@omni/shared/github-check.ts';
import { claudeAccountLine, claudeCheck, type ClaudeLoginStart, type ClaudeSetup, type ClaudeStep } from '@omni/shared/claude-setup.ts';
import { accountsByHarness, machineAccounts, type AccountsView, type HarnessAccountView } from '@omni/shared/harness-accounts.ts';
import { HARNESS_CHECK_LABEL, harnessAccountLine, harnessCheck, type HarnessCheck } from '@omni/shared/harness-check.ts';
import { ONBOARDING_TOOLS, otherTools, toolLine, toolList, withOtherTools } from '@omni/shared/onboarding.ts';
import { STARTER_AUTOMATIONS } from '@omni/shared/starter-automations.ts';
import { api, errorText, type HarnessWithRunning } from '../api.ts';
import { PERMISSION_LABEL, permissionNow, setNotificationsEnabled, useNotificationPrefs, type Permission } from '../attention.ts';
import { desktop } from '../desktop.ts';
import { DeviceCodeSignIn, type DeviceCodeWords } from './GoogleSignIn.tsx';
import { Button, ChipSet, CopyButton, ErrorNote, FolderInput, IDENTIFIER, Icon, Label, LinkButton, StatusDot, Toggle } from './ui.tsx';

export const PRONOUNS = ['they/them', 'she/her', 'he/him'];
export const STEPS = ['You', 'Work', 'Files', 'Harnesses', 'Project', 'Notifications', 'Routines', 'Done'] as const;

/** The answers the Work step asks for: a line about the user's work, and the tools line (packages/shared/onboarding.ts). */
export function WorkScreen({ work, tools, onWork, onTools }: { work: string; tools: string; onWork: (v: string) => void; onTools: (v: string) => void }) {
  const list = toolList(tools).map((t) => t.toLowerCase());
  const picked = ONBOARDING_TOOLS.filter((t) => list.includes(t.id.toLowerCase())).map((t) => t.id);
  const pick = (ids: string[]) => onTools(withOtherTools(toolLine(ids), otherTools(tools)));
  return (
    <Screen caption="Your work" title="What do you do?" body="A line or two is enough. Every agent reads it, so its answers fit your work and it reaches for your tools first.">
      <Row label="Your work" htmlFor="ob-work" hint="Optional. Change it any time in Settings > General.">
        <textarea
          id="ob-work"
          className="field min-h-[72px] w-full resize-y"
          value={work}
          maxLength={300}
          rows={3}
          placeholder="I run a small design studio: client projects, proposals and invoices."
          autoFocus
          onChange={(e) => onWork(e.target.value)}
        />
      </Row>
      <div>
        <Label hint="Pick any. Connect them later; until then an agent says what it would need.">Which tools do you use?</Label>
        <ChipSet label="Tools you use" options={ONBOARDING_TOOLS.map((t) => ({ id: t.id, label: t.label }))} value={picked} onChange={pick} />
      </div>
      <Row label="Others" htmlFor="ob-tools-other" hint="Comma separated.">
        <input id="ob-tools-other" className="field w-full" value={otherTools(tools)} placeholder="Xero, HubSpot" onChange={(e) => onTools(withOtherTools(tools, e.target.value))} />
      </Row>
    </Screen>
  );
}

/** What the Files step asks: the workspace folder, then, for someone who works with code, the repo add-on's fields. */
export interface FilesAnswers {
  root: string;
  reposDir: string;
  githubOwner: string;
}

/**
 * Where Omni keeps files: the workspace folder. Repos folder and GitHub owner are an add-on, open when the Work step
 * picked GitHub, when either is already saved, or when the user turns it on here.
 */
export function FilesScreen({
  value,
  onChange,
  code,
  onCode,
  fallbacks,
}: {
  value: FilesAnswers;
  onChange: (v: Partial<FilesAnswers>) => void;
  code: boolean;
  onCode: (on: boolean) => void;
  fallbacks: { workspaceRoot: string; reposDir: string };
}) {
  return (
    <Screen caption="Files" title="Where should Omni keep your files?" body="Agents work in this folder and save what they make there. Omni makes it if it is missing.">
      <Row label="Folder" htmlFor="ob-root">
        <FolderInput id="ob-root" dialogTitle="Where Omni keeps your files" value={value.root} placeholder={fallbacks.workspaceRoot} onChange={(root) => onChange({ root })} />
      </Row>
      <div className="flex items-start gap-4 rounded-[16px] bg-surface p-3.5" data-addon="code">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium">I work with code</div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">Point a project at a git repo and every thread there gets its own copy to work in.</p>
        </div>
        <Toggle checked={code} onChange={onCode} label="I work with code" />
      </div>
      {code && (
        <>
          <Row label="Repos folder" htmlFor="ob-repos" hint="Where your git checkouts live. Used to suggest repo paths for projects.">
            <FolderInput id="ob-repos" dialogTitle="Repos folder" value={value.reposDir} placeholder={fallbacks.reposDir} onChange={(reposDir) => onChange({ reposDir })} />
          </Row>
          <Row label="GitHub owner" htmlFor="ob-gh" hint="Optional. Your GitHub user or org, for your repos.">
            <input id="ob-gh" {...IDENTIFIER} className="field field-mono w-full" value={value.githubOwner} placeholder="octocat" onChange={(e) => onChange({ githubOwner: e.target.value })} />
          </Row>
        </>
      )}
    </Screen>
  );
}

export async function createChannel(name: string, repo: string, store: string) {
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'project';
  const ch = await api.post<{ id: string }>('/channels', {
    id: id.length < 2 ? `${id}-1` : id,
    name: name.trim(),
    kind: 'client',
    repo_path: repo.trim() || null,
    use_worktree: repo.trim() ? 1 : 0,
    store_domain: store.trim() || null,
  });
  return ch.id;
}

/** What a harness is for, under its row, when that is more than "another place to run threads". */
const HARNESS_NOTE: Partial<Record<string, string>> = {
  codex: 'Optional. Reviews a pull request Claude wrote when you ask the Conductor for a review.',
};

/** The rows the Harnesses step lists: each harness, then the GitHub CLI the PR steps run. */
export interface HarnessRows {
  harnesses: HarnessWithRunning[];
  /** This machine's accounts by harness (GET /api/accounts). Empty when it could not be read. */
  accounts: Record<string, HarnessAccountView>;
  /** Null when this server has no /api/setup/github (an older one) or the check failed. */
  github: GithubCheck | null;
  /** Claude Code as its own CLI says (GET /api/setup/claude). Null on an older server. */
  claude: ClaudeSetup | null;
}

async function loadRows(): Promise<HarnessRows> {
  const [harnesses, accounts, github, claude] = await Promise.all([
    api.get<HarnessWithRunning[]>('/harnesses'),
    api
      .get<AccountsView>('/accounts')
      .then((v): Record<string, HarnessAccountView> => (Array.isArray(v?.machines) ? accountsByHarness(machineAccounts(v, 'here')) : {}))
      .catch(() => ({})),
    // An older server has no /api/setup/github: no row then.
    api
      .get<GithubCheck>('/setup/github')
      .then((g) => (g && g.state in HARNESS_CHECK_LABEL ? g : null))
      .catch(() => null),
    api.get<ClaudeSetup>('/setup/claude').catch(() => null),
  ]);
  // Hermes and Cursor Cloud run off this Mac: listed once they work, never as something to install.
  return { harnesses: harnesses.filter((h) => (h.id !== 'hermes' && h.id !== 'cursor-cloud') || h.available), accounts, github, claude };
}

/**
 * `onGithub` hears the GitHub CLI's state each time it is read, so the Done screen can say whether it was connected.
 * `code` false (someone who said they do not work with code) leaves the GitHub CLI row out.
 */
export function HarnessScreen({ onGithub, code = true }: { onGithub?: (github: GithubCheck | null) => void; code?: boolean }) {
  const [rows, setRows] = useState<HarnessRows | null>(null);
  const [checking, setChecking] = useState(false);
  const load = async () => {
    setChecking(true);
    try {
      setRows(await loadRows());
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    load().catch(() => setRows({ harnesses: [], accounts: {}, github: null, claude: null }));
  }, []);
  const list = rows?.harnesses;
  // Claude Code's row asks the CLI itself, so a signed-out claude never shows as Ready.
  const checkOf = (h: HarnessWithRunning) => (h.id === 'claude-code' ? claudeCheck(rows?.claude ?? null, harnessCheck(h)) : harnessCheck(h));
  // What the CLI says now wins over the accounts list, which can still hold the login it had before.
  const claudeSays = rows?.claude && rows.claude.state !== 'unknown' ? rows.claude : null;
  const accountOf = (id: string) =>
    id === 'claude-code' && claudeSays ? (claudeSays.state === 'ready' ? (harnessAccountLine(rows?.accounts[id]) ?? claudeAccountLine(claudeSays)) : null) : harnessAccountLine(rows?.accounts[id]);
  const claude = list?.find((h) => h.id === 'claude-code');
  const claudeReady = claude ? checkOf(claude).state === 'ready' : true;
  const github = code ? rows?.github : null;
  const heard = useRef(onGithub);
  heard.current = onGithub;
  useEffect(() => {
    if (github !== undefined) heard.current?.(github);
  }, [github]);
  // Shown as signed in at once, then read again so the row matches what gh says.
  const connected = (login: string) => {
    setRows((r) => r && { ...r, github: { state: 'ready', login } });
    void load().catch(() => {});
  };
  const signedIn = list?.some((h) => accountOf(h.id));
  return (
    <Screen
      caption="Harnesses"
      title="The agents Omni can run"
      body="Each thread runs on a CLI you are signed in to, billed to that plan. Omni needs Claude Code. Codex and Cursor Agent are optional."
    >
      <ul className="space-y-2">
        {(list ?? []).map((h) => (
          <CheckRow
            key={h.id}
            id={h.id}
            name={h.name}
            plan={h.plan}
            check={checkOf(h)}
            note={HARNESS_NOTE[h.id]}
            account={accountOf(h.id)}
            action={h.id === 'claude-code' && rows?.claude ? <ClaudeConnect setup={rows.claude} onDone={() => void load().catch(() => {})} /> : undefined}
          />
        ))}
        {github && (
          <CheckRow
            id="github"
            name="GitHub CLI"
            plan="gh"
            check={github}
            note={GITHUB_NOTE}
            account={githubLine(github)}
            action={github.state === 'signed-out' ? <GithubConnect onDone={connected} /> : undefined}
          />
        )}
        {!list && <li className="py-6 text-center text-[13px] text-fg-3">Checking…</li>}
      </ul>
      {signedIn && <p className="text-[12px] leading-relaxed text-fg-3">Wrong account? Sign in to the right one in a terminal, then Check again. Settings {'>'} Accounts lists them later, for each of your machines.</p>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12px] text-fg-3">
          {!claudeReady
            ? 'Set up Claude Code before your first thread.'
            : github && github.state !== 'ready'
                ? 'Set up the GitHub CLI before you work on pull requests.'
                : 'You can add the others any time.'}
        </span>
        <Button variant="ghost" busy={checking} onClick={() => void load()}>
          Check again
        </Button>
      </div>
    </Screen>
  );
}

const GITHUB_NOTE = 'Pull requests: watching them, Auto-merge, rerunning failed checks and the Conductor’s PR reviews all run gh.';

const GITHUB_WORDS: DeviceCodeWords = {
  intro: 'Enter this code on GitHub and approve. gh then signs in on the machine Omni runs on, and keeps the token itself.',
  open: 'Open GitHub',
  denied: 'Sign-in was declined on GitHub.',
  expired: 'The code expired before it was entered. Connect again.',
  cancelled: 'Cancelled. gh is still signed out.',
};

/**
 * Connect GitHub: gh's own web sign-in (POST /api/setup/github/login runs `gh auth login --web`). The card shows
 * gh's one-time code and links to GitHub's device page; Cancel stops gh. Skipping it changes nothing.
 */
function GithubConnect({ onDone }: { onDone: (login: string) => void }) {
  return (
    <DeviceCodeSignIn<{ state: 'signed_in'; login: string }>
      label="Connect GitHub"
      icon="plug"
      variant="secondary"
      start={() => api.post<GhLoginStart>('/setup/github/login', {})}
      pollPath="/setup/github/login/poll"
      onCancel={(f) => void api.post('/setup/github/login/cancel', { flow: f.flow, secret: f.secret }).catch(() => {})}
      words={GITHUB_WORDS}
      onDone={(r) => onDone(r.login)}
    />
  );
}

/**
 * Claude Code with no terminal (apps/server/claude-setup.ts): Install runs Claude Code's own installer on the machine
 * Omni runs on; Sign in opens claude.com's page, which shows a code to paste back here for the CLI. Either reads the
 * rows again when it is done. Nothing for a ready or an unreadable Claude Code.
 */
export function ClaudeConnect({ setup, onDone }: { setup: ClaudeSetup; onDone: () => void }) {
  if (setup.state === 'missing') return <ClaudeInstall onDone={onDone} />;
  if (setup.state === 'signed-out') return <ClaudeSignIn onDone={onDone} />;
  return null;
}

const INSTALL_POLL_MS = 1500;

function ClaudeInstall({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const { flow } = await api.post<{ flow: string }>('/setup/claude/install', {});
      let step: ClaudeStep = { state: 'running' };
      while (step.state === 'running') {
        await new Promise((r) => setTimeout(r, INSTALL_POLL_MS));
        if (!alive.current) return;
        step = await api.get<ClaudeStep>(`/setup/claude/install/${flow}`);
      }
      if (step.state === 'failed') throw new Error(step.error || 'The installer stopped without saying why.');
      onDone();
    } catch (err) {
      if (alive.current) setError(errorText(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5" data-claude="install">
      <Button variant="secondary" icon="download" busy={busy} onClick={() => void install()}>
        {busy ? 'Installing Claude Code…' : 'Install Claude Code'}
      </Button>
      {error && <ErrorNote>{error}</ErrorNote>}
      <p className="text-[12px] leading-relaxed text-fg-3">Runs Claude Code’s own installer on the machine Omni runs on. Or run it yourself:</p>
    </div>
  );
}

function ClaudeSignIn({ onDone }: { onDone: () => void }) {
  const [flow, setFlow] = useState<ClaudeLoginStart | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = useRef<ClaudeLoginStart | null>(null);
  waiting.current = flow;
  // Leaving the step stops a sign-in still waiting for its code.
  useEffect(
    () => () => {
      if (waiting.current) void api.post('/setup/claude/login/cancel', { flow: waiting.current.flow }).catch(() => {});
    },
    [],
  );
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setFlow(await api.post<ClaudeLoginStart>('/setup/claude/login', {}));
      setCode('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    if (!flow || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<ClaudeStep>('/setup/claude/login/code', { flow: flow.flow, code });
      // Either way this flow is over: the CLI took the code and finished, or refused it and stopped.
      setFlow(null);
      if (r.state === 'done') onDone();
      else setError(r.error || 'Claude Code is still signed out. Start again.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (flow) void api.post('/setup/claude/login/cancel', { flow: flow.flow }).catch(() => {});
    setFlow(null);
  };
  if (!flow) {
    return (
      <div className="space-y-1.5" data-claude="sign-in">
        <Button variant="secondary" icon="key" busy={busy} onClick={() => void start()}>
          Sign in to Claude
        </Button>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-[16px] bg-bg p-4" data-claude="code">
      <p className="text-[13px] text-fg-2">Open the Claude page and sign in. It then shows a code: paste it here. Claude Code keeps the login itself, as it does in a terminal.</p>
      <LinkButton href={flow.url} target="_blank" variant="primary" icon="external">
        Open Claude sign-in
      </LinkButton>
      {/* Not a form: the wizard around it is one, and Enter here finishes the sign-in, not the step. */}
      <div className="space-y-2">
        <input
          {...IDENTIFIER}
          className="field field-mono w-full"
          value={code}
          placeholder="Paste the code"
          aria-label="Code from the Claude page"
          autoComplete="one-time-code"
          enterKeyHint="done"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void finish();
          }}
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" busy={busy} disabled={!code.trim()} onClick={() => void finish()}>
            Finish
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One harness, or the GitHub CLI: ready or not, who it is signed in as, and what to run when it is not ready.
 * `action` sits above the commands, as Connect GitHub does.
 */
function CheckRow({
  id,
  name,
  plan,
  check,
  note,
  account,
  action,
}: {
  id: string;
  name: string;
  plan: string;
  check: HarnessCheck;
  note?: string;
  account?: string | null;
  action?: ReactNode;
}) {
  const ready = check.state === 'ready';
  return (
    <li className="rounded-[16px] bg-surface p-3.5" data-harness={id} data-state={check.state}>
      <div className="flex items-center gap-2.5">
        <span className={`grid h-6 w-6 place-items-center rounded-full ${ready ? 'bg-done text-on-done' : 'bg-bg text-fg-3'}`}>
          <Icon name={ready ? 'check' : 'x'} size={13} />
        </span>
        <span className="text-[13.5px] font-medium">{name}</span>
        <span className="text-[12px] text-fg-3">{plan}</span>
        <span className={`ml-auto text-[12px] ${ready ? 'text-fg-2' : 'text-fg-3'}`}>{HARNESS_CHECK_LABEL[check.state]}</span>
      </div>
      {(account || note || !ready) && (
        <div className="mt-2.5 space-y-1.5 pl-[34px]">
          {account && (
            <p className="truncate text-[12px] text-fg-2" data-account>
              {account}
            </p>
          )}
          {note && <p className="text-[12px] leading-relaxed text-fg-3">{note}</p>}
          {action}
          {check.install && <Command label="Install" cmd={check.install} />}
          {check.command && <Command label="Sign in" cmd={check.command} />}
          {check.reason && <p className="text-[12px] leading-relaxed text-fg-2">{check.reason}</p>}
        </div>
      )}
    </li>
  );
}

const NOTIFY_BODY = 'Omni can tell you when an agent asks you something, a thread finishes or fails, or the crew reports back.';

/**
 * Asks about notifications now, not in the middle of work: in the desktop app a sample notification brings up the
 * OS's permission prompt (macOS asks at the first one); in a browser the switch asks the browser, as Settings does.
 */
export function NotificationsScreen({ bridge = desktop }: { bridge?: DesktopBridge | null }) {
  return bridge?.nativeNotifications ? <AppNotify bridge={bridge} /> : <BrowserNotify />;
}

const MORE = 'Pick which kinds notify, and which channels stay quiet, in Settings > Notifications.';

function SwitchRow({ title, detail, checked, onChange, disabled }: { title: string; detail: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-4 rounded-[16px] bg-surface p-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">{detail}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

const PERMISSION_GLYPH: Record<Permission, string> = { granted: 'done', denied: 'needs', default: 'settled', unsupported: 'settled' };

function BrowserNotify() {
  const prefs = useNotificationPrefs();
  const [permission, setPermission] = useState<Permission>(permissionNow);
  const toggle = async (on: boolean) => setPermission(await setNotificationsEnabled(on));
  return (
    <Screen caption="Notifications" title="Hear when work needs you" body={`${NOTIFY_BODY} In a browser they start off.`}>
      <SwitchRow
        title="Notify in this browser"
        detail="While an Omni tab is open. Turning it on asks the browser once."
        checked={prefs.enabled}
        onChange={(on) => void toggle(on)}
        disabled={permission === 'unsupported'}
      />
      <p className="flex items-center gap-1.5 text-[12.5px] text-fg-2" data-permission={permission}>
        <StatusDot status={PERMISSION_GLYPH[permission]} size={7} />
        {PERMISSION_LABEL[permission]}
      </p>
      {permission === 'unsupported' && (
        <p className="text-[12.5px] leading-relaxed text-fg-3">On an iPhone, the Omni app sends push alerts instead. Pair it from Settings {'>'} Sharing &amp; access.</p>
      )}
      {prefs.enabled && permission === 'denied' && <ErrorNote>The browser blocks notifications for Omni. Allow them in the site settings (the icon left of the address), then turn this on again.</ErrorNote>}
      <p className="text-[12px] text-fg-3">{MORE}</p>
    </Screen>
  );
}

function AppNotify({ bridge }: { bridge: DesktopBridge }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [sent, setSent] = useState<'sent' | 'unsupported' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    bridge.settings.get().then(
      (s) => setEnabled(s.notifications.enabled),
      (err) => setError(errorText(err)),
    );
  }, [bridge]);
  const where = bridge.platform === 'darwin' ? 'System Settings > Notifications > Omni' : 'your desktop’s notification settings';
  const save = async (on: boolean) => {
    setError(null);
    try {
      setEnabled((await bridge.settings.set({ notifications: { enabled: on } })).notifications.enabled);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      setSent((await bridge.testNotification!()) ? 'sent' : 'unsupported');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      caption="Notifications"
      title="Hear when work needs you"
      body={`${NOTIFY_BODY} The app sends them even with every window closed.${bridge.platform === 'darwin' ? ' macOS asks once whether Omni may; send a test now so it asks here, not mid-task.' : ''}`}
    >
      <SwitchRow title="Notify from the desktop app" detail="Native notifications. Clicking one opens its thread." checked={enabled ?? true} onChange={(on) => void save(on)} disabled={enabled === null} />
      {bridge.testNotification && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void test()} busy={busy} disabled={enabled === false}>
            Send a test notification
          </Button>
          {sent && (
            <span className="text-[12.5px] text-fg-2" data-sent={sent}>
              {sent === 'sent' ? `Sent. If nothing showed, allow Omni in ${where}.` : 'This system cannot show notifications.'}
            </span>
          )}
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <p className="text-[12px] text-fg-3">{MORE}</p>
    </Screen>
  );
}

/**
 * The starter routines (packages/shared/starter-automations.ts), each off until turned on here. One that is already
 * an automation (a second run of setup) shows as on and stays as it is; Automations edits or removes it.
 */
export function RoutinesScreen({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [have, setHave] = useState<string[]>([]);
  useEffect(() => {
    api
      .get<{ id: string }[]>('/automations')
      .then((list) => setHave(list.map((a) => a.id)))
      .catch(() => {});
  }, []);
  return (
    <Screen
      caption="Routines"
      title="Start with a routine or two"
      body="Each runs on a schedule as the Admin role and answers in General. They start off: turn one on and it becomes an automation you can change or turn off in Automations."
    >
      {STARTER_AUTOMATIONS.map((s) => {
        const saved = have.includes(s.id);
        return (
          <div key={s.id} data-starter={s.id}>
            <SwitchRow
              title={s.name}
              detail={`${s.when}. ${s.blurb}`}
              checked={saved || value.includes(s.id)}
              disabled={saved}
              onChange={(on) => onChange(on ? [...value, s.id] : value.filter((id) => id !== s.id))}
            />
          </div>
        );
      })}
      <p className="text-[12px] leading-relaxed text-fg-3">
        Morning plan and Mail follow-ups post nothing on a day with nothing to report. Mail follow-ups asks before it sends anything, and a draft nobody approves expires after 8 hours.
      </p>
    </Screen>
  );
}

function Command({ label, cmd }: { label: string; cmd: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-12 shrink-0 text-[11.5px] text-fg-3">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-[8px] bg-code px-2 py-1 font-mono text-[12px]">{cmd}</code>
      <CopyButton text={cmd} />
    </div>
  );
}

export function Steps({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
      {STEPS.map((s, i) => (
        <li key={s} title={s} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-fg' : i < step ? 'w-1.5 bg-fg-2' : 'w-1.5 bg-fg-4'}`} />
      ))}
    </ol>
  );
}

export function Screen({ caption, title, body, children }: { caption: string; title: string; body: string; children: ReactNode }) {
  return (
    <div>
      <div className="caption mb-2">{caption}</div>
      <h2 id="onboarding-title" className="font-display text-[length:var(--fs-title)] leading-[1.15]">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-3">{body}</p>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

export function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

export function Summary({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-3">{k}</dt>
      <dd className={`min-w-0 truncate ${mono ? 'font-mono text-[12.5px]' : ''}`}>{v}</dd>
    </>
  );
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

export function TimezoneInput({ id, value, onChange, describedBy }: { id: string; value: string; onChange: (v: string) => void; describedBy?: string }) {
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  }, []);
  return (
    <>
      <input id={id} aria-describedby={describedBy} className="field w-full" list={`${id}-zones`} value={value} placeholder="Europe/Amsterdam" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${id}-zones`}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}

export function PronounsInput({ id, value, onChange, describedBy }: { id: string; value: string; onChange: (v: string) => void; describedBy?: string }) {
  const custom = !PRONOUNS.includes(value);
  const [other, setOther] = useState(custom);
  return (
    <div className="flex gap-2">
      <select
        id={id}
        aria-describedby={describedBy}
        className="field min-w-0 flex-1"
        value={other ? 'other' : value}
        onChange={(e) => {
          const v = e.target.value;
          setOther(v === 'other');
          if (v !== 'other') onChange(v);
          else onChange('');
        }}
      >
        {PRONOUNS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value="other">Other…</option>
      </select>
      {other && <input aria-label="Your pronouns" className="field min-w-0 flex-1" value={value} placeholder="xe/xem" onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}
