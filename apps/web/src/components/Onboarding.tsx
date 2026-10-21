import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorText, type HarnessWithRunning, type SetupState, type UserConfigPatch } from '../api.ts';
import { navigate, href } from '../router.ts';
import { useApp } from '../store.tsx';
import { OmniMark } from './brand.tsx';
import { Button, CopyButton, ErrorNote, Icon, Label } from './ui.tsx';

// Onboarding: five short screens on first run (no data/omni.config.json yet), or again from Settings. It writes the
// user config through /api/setup; the Mac app (OnboardingSheet.swift) and `npm run setup` ask the same questions.

export const NAME_MAX = 60;
const PRONOUNS = ['they/them', 'she/her', 'he/him'];
const STEPS = ['You', 'Workspace', 'Harnesses', 'Channel', 'Done'] as const;

type HarnessRow = HarnessWithRunning & { install?: string };

export function Onboarding() {
  const { setupOpen } = useApp();
  return setupOpen ? <Wizard /> : null;
}

function Wizard() {
  const { closeSetup, reloadProfile, reloadChannels } = useApp();
  const [state, setState] = useState<SetupState | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The answers, prefilled from what is saved, else from this machine.
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('');
  const [pronouns, setPronouns] = useState('they/them');
  const [root, setRoot] = useState('');
  const [reposDir, setReposDir] = useState('');
  const [githubOwner, setGithubOwner] = useState('');
  const [channelName, setChannelName] = useState('');
  const [channelRepo, setChannelRepo] = useState('');
  const [channelStore, setChannelStore] = useState('');
  const [createdChannel, setCreatedChannel] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SetupState>('/setup')
      .then((s) => {
        setState(s);
        setName(s.config.user.name);
        setEmail(s.config.user.email);
        setTimezone(s.config.user.timezone || browserTimezone() || s.fallbacks.timezone);
        setPronouns(s.config.user.pronouns || 'they/them');
        setRoot(s.config.workspace.root);
        setReposDir(s.config.workspace.reposDir);
        setGithubOwner(s.config.workspace.githubOwner || s.omniRepo?.split('/')[0] || '');
      })
      .catch((err) => setError(errorText(err)));
  }, []);

  const rerun = !!state?.onboarded;

  const patch = (): UserConfigPatch => ({
    user: { name: name.trim().replace(/\s+/g, ' '), email: email.trim(), timezone: timezone.trim(), pronouns: pronouns.trim() || 'they/them' },
    workspace: { root: root.trim(), reposDir: reposDir.trim(), githubOwner: githubOwner.trim() },
  });

  // Each step saves what it asked, so a closed tab keeps the answers. The last one marks onboarding done.
  const save = async () => setState(await api.put<SetupState>('/setup', patch()));

  const finish = async (body: UserConfigPatch) => {
    const done = await api.post<SetupState>('/setup/complete', body);
    await reloadProfile();
    reloadChannels();
    closeSetup();
    if (done.threadId) navigate(href.thread(done.threadId).slice(1));
    else if (!rerun) navigate(href.channel('conductor').slice(1));
  };

  const next = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (step === 0 && !name.trim()) return setError('Enter a name, or skip setup for now.');
    if (step === 0 && name.trim().length > NAME_MAX) return setError(`Keep the name under ${NAME_MAX} characters.`);
    setBusy(true);
    try {
      if (step === 0 || step === 1) await save();
      if (step === 3 && channelName.trim() && !createdChannel) {
        setCreatedChannel(await createChannel(channelName, channelRepo, channelStore));
        reloadChannels();
      }
      if (step === 4) return await finish(patch());
      setStep((s) => s + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      // Skipping still writes the file, so this is not asked again; Settings has every field.
      await finish({});
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="scrim fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <form
        onSubmit={next}
        className="modal-in flex max-h-[100dvh] w-full flex-col rounded-t-[28px] bg-elev shadow-[var(--shadow-menu)] sm:max-h-[min(720px,calc(100dvh-48px))] sm:max-w-lg sm:rounded-[28px]"
      >
        <div className="flex items-center justify-between gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
          <OmniMark size={32} state={busy ? 'thinking' : 'idle'} />
          <Steps step={step} />
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pt-5 sm:px-8">
          {!state && !error && <p className="py-10 text-center text-[13px] text-fg-3">Loading…</p>}
          {state && step === 0 && (
            <Screen caption={rerun ? 'Setup' : 'Welcome to Omni'} title="Tell Omni about you" body="Your name and pronouns are told to every agent, so a thread knows who it works for. Automations use your timezone.">
              <Row label="Name" htmlFor="ob-name">
                <input id="ob-name" className="field w-full" value={name} maxLength={NAME_MAX} autoComplete="name" placeholder="Your name" autoFocus onChange={(e) => setName(e.target.value)} />
              </Row>
              <Row label="Email" htmlFor="ob-email" hint="Optional. Agents use it to recognise your own commits, PRs and mail.">
                <input id="ob-email" className="field w-full" type="email" value={email} autoComplete="email" placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
              </Row>
              <div className="grid gap-4 sm:grid-cols-2">
                <Row label="Timezone" htmlFor="ob-tz" hint="Prefilled from this device.">
                  <TimezoneInput id="ob-tz" value={timezone} onChange={setTimezone} />
                </Row>
                <Row label="Pronouns" htmlFor="ob-pronouns">
                  <PronounsInput id="ob-pronouns" value={pronouns} onChange={setPronouns} />
                </Row>
              </div>
            </Screen>
          )}
          {state && step === 1 && (
            <Screen caption="Workspace" title="Where your work lives" body="Threads in a channel without a repo run in the workspace folder, and its CLAUDE.md and skills load in every Claude thread. Omni makes it if it is missing.">
              <Row label="Workspace folder" htmlFor="ob-root">
                <input id="ob-root" className="field w-full font-mono !text-[13px]" value={root} placeholder={state.fallbacks.workspaceRoot} spellCheck={false} onChange={(e) => setRoot(e.target.value)} />
              </Row>
              <Row label="Repos folder" htmlFor="ob-repos" hint="Where your git checkouts live. Used to suggest repo paths for channels.">
                <input id="ob-repos" className="field w-full font-mono !text-[13px]" value={reposDir} placeholder={state.fallbacks.reposDir} spellCheck={false} onChange={(e) => setReposDir(e.target.value)} />
              </Row>
              <Row label="GitHub owner" htmlFor="ob-gh" hint="Your GitHub user or org, for your repos and your fork of Omni.">
                <input id="ob-gh" className="field w-full font-mono !text-[13px]" value={githubOwner} placeholder="octocat" spellCheck={false} autoCapitalize="off" onChange={(e) => setGithubOwner(e.target.value)} />
              </Row>
            </Screen>
          )}
          {state && step === 2 && <HarnessScreen />}
          {state && step === 3 && (
            <Screen caption="First channel" title="Add a client or project" body="A channel holds the threads for one client or project. With a repo, every thread gets its own git worktree. Skip it and add channels later from the sidebar.">
              {createdChannel ? (
                <p className="rounded-[16px] bg-surface p-4 text-[13px] text-fg-2">
                  Created <span className="font-medium text-fg">#{createdChannel}</span>.
                </p>
              ) : (
                <>
                  <Row label="Name" htmlFor="ob-ch-name">
                    <input id="ob-ch-name" className="field w-full" value={channelName} placeholder="Acme" onChange={(e) => setChannelName(e.target.value)} />
                  </Row>
                  <Row label="Repo folder" htmlFor="ob-ch-repo" hint="Optional. A git checkout on this Mac.">
                    <input
                      id="ob-ch-repo"
                      className="field w-full font-mono !text-[13px]"
                      value={channelRepo}
                      placeholder={`${state.resolved.reposDir}/acme-theme`}
                      spellCheck={false}
                      onChange={(e) => setChannelRepo(e.target.value)}
                    />
                  </Row>
                  <Row label="Shopify store" htmlFor="ob-ch-store" hint="Optional. The myshopify domain.">
                    <input id="ob-ch-store" className="field w-full font-mono !text-[13px]" value={channelStore} placeholder="acme.myshopify.com" spellCheck={false} onChange={(e) => setChannelStore(e.target.value)} />
                  </Row>
                </>
              )}
            </Screen>
          )}
          {state && step === 4 && (
            <Screen caption="Done" title={`You're set${name.trim() ? `, ${name.trim().split(' ')[0]}` : ''}`} body={rerun ? 'Save to keep these settings.' : 'Omni opens #conductor with a welcome message. Tell the Conductor what you need and it hands the work to the right crew role.'}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-[16px] bg-surface p-4 text-[13px]">
                <Summary k="Name" v={name.trim()} />
                <Summary k="Pronouns" v={pronouns} />
                <Summary k="Timezone" v={timezone || state.resolved.timezone} />
                <Summary k="Workspace" v={root || state.fallbacks.workspaceRoot} mono />
                <Summary k="GitHub" v={githubOwner || 'not set'} mono />
                {createdChannel && <Summary k="Channel" v={`#${createdChannel}`} />}
              </dl>
              <p className="mt-3 text-[12px] text-fg-3">
                Saved in <code className="font-mono">{state.path}</code>, which stays out of git. Change it any time in Settings, or run <code className="font-mono">npm run setup</code>.
              </p>
            </Screen>
          )}
          {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
        </div>
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-[calc(24px+env(safe-area-inset-bottom))] sm:px-8 sm:pb-8">
          {step === 0 ? (
            <Button variant="ghost" onClick={rerun ? closeSetup : skip} disabled={busy}>
              {rerun ? 'Cancel' : 'Skip setup'}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => (setError(null), setStep((s) => s - 1))} disabled={busy}>
              Back
            </Button>
          )}
          <div className="flex items-center gap-2">
            {step === 3 && !createdChannel && !channelName.trim() && <span className="text-[12px] text-fg-3">Optional</span>}
            <Button type="submit" variant="primary" busy={busy} disabled={!state}>
              {step === 4 ? (rerun ? 'Save' : 'Open Conductor') : step === 3 && !channelName.trim() && !createdChannel ? 'Skip' : 'Continue'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

async function createChannel(name: string, repo: string, store: string) {
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

function HarnessScreen() {
  const [list, setList] = useState<HarnessRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const load = async () => {
    setChecking(true);
    try {
      setList((await api.get<HarnessRow[]>('/harnesses')).filter((h) => h.id !== 'hermes' || h.available));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    load().catch(() => setList([]));
  }, []);
  const claude = list?.find((h) => h.id === 'claude-code');
  return (
    <Screen caption="Harnesses" title="The agents Omni can run" body="Each thread runs on a CLI you are signed in to, billed to that plan. Omni needs Claude Code; Codex and Cursor Agent are optional.">
      <ul className="space-y-2">
        {(list ?? []).map((h) => (
          <li key={h.id} className="rounded-[16px] bg-surface p-3.5">
            <div className="flex items-center gap-2.5">
              <span className={`grid h-6 w-6 place-items-center rounded-full ${h.available ? 'bg-done text-on-done' : 'bg-bg text-fg-3'}`}>
                <Icon name={h.available ? 'check' : 'x'} size={13} />
              </span>
              <span className="text-[13.5px] font-medium">{h.name}</span>
              <span className="text-[12px] text-fg-3">{h.plan}</span>
              <span className={`ml-auto text-[12px] ${h.available ? 'text-fg-2' : 'text-fg-3'}`}>{h.available ? 'Ready' : 'Not set up'}</span>
            </div>
            {!h.available && (h.install || h.fix) && (
              <div className="mt-2.5 space-y-1.5 pl-[34px]">
                {h.install && <Command label="Install" cmd={h.install} />}
                {h.fix && <Command label="Sign in" cmd={h.fix} />}
              </div>
            )}
          </li>
        ))}
        {!list && <li className="py-6 text-center text-[13px] text-fg-3">Checking…</li>}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12px] text-fg-3">{claude && !claude.available ? 'Set up Claude Code before your first thread.' : 'You can add the others any time.'}</span>
        <Button variant="ghost" busy={checking} onClick={() => void load()}>
          Check again
        </Button>
      </div>
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

function Steps({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
      {STEPS.map((s, i) => (
        <li key={s} title={s} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-fg' : i < step ? 'w-1.5 bg-fg-2' : 'w-1.5 bg-line-strong'}`} />
      ))}
    </ol>
  );
}

function Screen({ caption, title, body, children }: { caption: string; title: string; body: string; children: ReactNode }) {
  return (
    <div>
      <div className="caption mb-2">{caption}</div>
      <h2 id="onboarding-title" className="font-display text-[24px] leading-[1.1]">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-3">{body}</p>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function Summary({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
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

export function TimezoneInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  }, []);
  return (
    <>
      <input id={id} className="field w-full" list={`${id}-zones`} value={value} placeholder="Europe/Amsterdam" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${id}-zones`}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}

export function PronounsInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const custom = !PRONOUNS.includes(value);
  const [other, setOther] = useState(custom);
  return (
    <div className="flex gap-2">
      <select
        id={id}
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
