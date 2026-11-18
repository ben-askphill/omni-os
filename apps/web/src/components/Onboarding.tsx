import { useEffect, useState, type FormEvent } from 'react';
import { githubLine, type GithubCheck } from '@omni/shared/github-check.ts';
import { HARNESS_CHECK_LABEL } from '@omni/shared/harness-check.ts';
import { NAME_MAX } from '@omni/shared/settings.ts';
import { api, errorText, type SetupState, type UserConfigPatch } from '../api.ts';
import { desktop } from '../desktop.ts';
import { useLayout } from '../layout-pref.ts';
import { navigate, href } from '../router.ts';
import { useApp, useIsMobile } from '../store.tsx';
import { OmniMark } from './brand.tsx';
import { HarnessScreen, NotificationsScreen, PronounsInput, Row, STEPS, Screen, Steps, Summary, TimezoneInput, browserTimezone, createChannel } from './onboarding-parts.tsx';
import { Button, ErrorNote, FolderInput } from './ui.tsx';
import { ModalFooter, SCRIM } from './ui/modal.tsx';

export { PronounsInput, TimezoneInput } from './onboarding-parts.tsx';

// Onboarding: six short screens on first run (no data/omni.config.json yet), or again from Settings. It writes the
// user config through /api/setup. In a checkout, `npm run setup` asks the same questions, all but notifications.

/** The last screen, which saves. */
const DONE = STEPS.length - 1;

/** Where to add a channel later, in the layout this wizard opened over. */
export function addChannelHint(where: 'phone' | 'rail' | 'classic') {
  if (where === 'phone') return 'Skip it and add channels later in Settings > Channels.';
  if (where === 'rail') return 'Skip it and add channels later with Add channel (+) at the foot of the rail.';
  return 'Skip it and add channels later with Add channel in the sidebar.';
}

/**
 * Whether the Done screen offers `npm run setup`: only for a checkout's server seen outside the desktop app. The
 * desktop app's server has no checkout, and the script writes a checkout's data/, which the app never reads.
 */
export const offersNpmSetup = (install: SetupState['install'], inApp: boolean) => install === 'checkout' && !inApp;

/** One line on the Done screen: what it is for, and where. `code` is shown as a command. */
export interface DoneTip {
  id: 'phone' | 'machine' | 'cli';
  text: string;
  code?: string;
}

/**
 * What to set up next, on the Done screen: the iPhone app and a second machine on every layout, and the `omni`
 * command where a terminal is likely. The desktop app puts `omni` on PATH (apps/desktop/src/cli-shim.ts); a checkout
 * runs it as scripts/omni.sh. A phone has no terminal, so it gets no command.
 */
export function doneTips(install: SetupState['install'], where: 'phone' | 'rail' | 'classic'): DoneTip[] {
  const tips: DoneTip[] = [
    { id: 'phone', text: 'Add your iPhone: make a pairing code in Settings > Sharing & access > Omni for iOS.' },
    { id: 'machine', text: 'Run threads on a second machine: turn on Settings > Sync on both, then pick one with Run on.' },
  ];
  if (where !== 'phone') {
    tips.push(
      install === 'app'
        ? { id: 'cli', text: 'From a terminal, start a thread or check this install:', code: 'omni new "…"  ·  omni doctor' }
        : { id: 'cli', text: 'From a terminal in this checkout, start a thread or check the install:', code: 'scripts/omni.sh new "…"  ·  scripts/omni.sh doctor' },
    );
  }
  return tips;
}

export function DoneTips({ tips }: { tips: DoneTip[] }) {
  return (
    <div className="mt-4">
      <div className="caption mb-1.5">Next</div>
      <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-fg-2">
        {tips.map((t) => (
          <li key={t.id} data-tip={t.id}>
            {t.text}
            {t.code && (
              <>
                {' '}
                <code className="font-mono text-[12px] text-fg">{t.code}</code>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export { NAME_MAX };

export function Onboarding() {
  const { setupOpen } = useApp();
  return setupOpen ? <Wizard /> : null;
}

function Wizard() {
  const { closeSetup, reloadProfile, reloadChannels } = useApp();
  const phone = useIsMobile();
  const layout = useLayout();
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
  /** The GitHub CLI as the Harnesses step last read it; null when this server cannot say. */
  const [github, setGithub] = useState<GithubCheck | null>(null);

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
    if (done.threadId) navigate(href.thread(done.threadId));
    else if (!rerun) navigate(href.channel('conductor'));
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
      if (step === DONE) return await finish(patch());
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
    <div className={`${SCRIM} items-end p-0 sm:items-center sm:p-6`} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <form
        onSubmit={next}
        className="modal-in flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[var(--r-3xl)] bg-elev shadow-[var(--shadow-menu)] sm:max-h-[min(720px,calc(100dvh-48px))] sm:max-w-lg sm:rounded-[var(--r-3xl)]"
      >
        <div className="flex items-center justify-between gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
          <OmniMark size={32} />
          <Steps step={step} />
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6 sm:px-8">
          {!state && !error && <p className="py-10 text-center text-[13px] text-fg-3">Loading…</p>}
          {state && step === 0 && (
            <Screen caption={rerun ? 'Setup' : 'Welcome to Omni'} title="Tell Omni about you" body="Your name and pronouns are told to every agent, so a thread knows who it works for. Automations use your timezone.">
              <Row label="Name" htmlFor="ob-name" hint="Agents address you by this name.">
                <input id="ob-name" className="field w-full" value={name} maxLength={NAME_MAX} autoComplete="name" placeholder="Your name" autoFocus onChange={(e) => setName(e.target.value)} />
              </Row>
              <Row label="Email" htmlFor="ob-email" hint="Optional. Agents use it to recognise your own commits, PRs and mail.">
                <input id="ob-email" className="field w-full" type="email" value={email} autoComplete="email" placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
              </Row>
              <div className="grid gap-4 sm:grid-cols-2">
                <Row label="Timezone" htmlFor="ob-tz" hint="Prefilled from this device.">
                  <TimezoneInput id="ob-tz" value={timezone} onChange={setTimezone} />
                </Row>
                <Row label="Pronouns" htmlFor="ob-pronouns" hint="Used when agents mention you.">
                  <PronounsInput id="ob-pronouns" value={pronouns} onChange={setPronouns} />
                </Row>
              </div>
            </Screen>
          )}
          {state && step === 1 && (
            <Screen caption="Workspace" title="Where your work lives" body="Threads in a channel without a repo run in the workspace folder, and its CLAUDE.md and skills load in every Claude thread. Omni makes it if it is missing.">
              <Row label="Workspace folder" htmlFor="ob-root">
                <FolderInput id="ob-root" dialogTitle="Workspace folder" value={root} placeholder={state.fallbacks.workspaceRoot} spellCheck={false} onChange={setRoot} />
              </Row>
              <Row label="Repos folder" htmlFor="ob-repos" hint="Where your git checkouts live. Used to suggest repo paths for channels.">
                <FolderInput id="ob-repos" dialogTitle="Repos folder" value={reposDir} placeholder={state.fallbacks.reposDir} spellCheck={false} onChange={setReposDir} />
              </Row>
              <Row label="GitHub owner" htmlFor="ob-gh" hint="Your GitHub user or org, for your repos and your fork of Omni.">
                <input id="ob-gh" className="field w-full font-mono !text-[13px]" value={githubOwner} placeholder="octocat" spellCheck={false} autoCapitalize="off" onChange={(e) => setGithubOwner(e.target.value)} />
              </Row>
            </Screen>
          )}
          {state && step === 2 && <HarnessScreen onGithub={setGithub} />}
          {state && step === 3 && (
            <Screen
              caption="First channel"
              title="Add a client or project"
              body={`A channel holds the threads for one client or project. With a repo, every thread gets its own git worktree. ${addChannelHint(phone ? 'phone' : layout)}`}
            >
              {createdChannel ? (
                <p className="rounded-[16px] bg-surface p-4 text-[13px] text-fg-2">
                  Created <span className="font-medium text-fg">#{createdChannel}</span>.
                </p>
              ) : (
                <>
                  <Row label="Name" htmlFor="ob-ch-name">
                    <input id="ob-ch-name" className="field w-full" value={channelName} placeholder="Acme" onChange={(e) => setChannelName(e.target.value)} />
                  </Row>
                  <Row label="Repo folder" htmlFor="ob-ch-repo" hint="Optional. A git checkout on this machine.">
                    <FolderInput
                      id="ob-ch-repo"
                      dialogTitle="Repo folder"
                      value={channelRepo}
                      placeholder={`${state.resolved.reposDir}/acme-theme`}
                      spellCheck={false}
                      onChange={setChannelRepo}
                    />
                  </Row>
                  <Row label="Shopify store" htmlFor="ob-ch-store" hint="Optional. The myshopify domain.">
                    <input id="ob-ch-store" className="field w-full font-mono !text-[13px]" value={channelStore} placeholder="acme.myshopify.com" spellCheck={false} onChange={(e) => setChannelStore(e.target.value)} />
                  </Row>
                </>
              )}
            </Screen>
          )}
          {state && step === 4 && <NotificationsScreen />}
          {state && step === DONE && (
            <Screen caption="Done" title={`You're set${name.trim() ? `, ${name.trim().split(' ')[0]}` : ''}`} body={rerun ? 'Save to keep these settings.' : 'Omni opens #conductor with a welcome message. Tell the Conductor what you need and it hands the work to the right crew role.'}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-[16px] bg-surface p-4 text-[13px]">
                <Summary k="Name" v={name.trim()} />
                <Summary k="Pronouns" v={pronouns} />
                <Summary k="Timezone" v={timezone || state.resolved.timezone} />
                <Summary k="Workspace" v={root || state.fallbacks.workspaceRoot} mono />
                <Summary k="GitHub" v={githubOwner || 'not set'} mono />
                {github && <Summary k="GitHub CLI" v={githubLine(github) ?? HARNESS_CHECK_LABEL[github.state]} />}
                {createdChannel && <Summary k="Channel" v={`#${createdChannel}`} />}
              </dl>
              <SavedNote path={state.path} install={state.install} />
              {!rerun && <DoneTips tips={doneTips(state.install, phone ? 'phone' : layout)} />}
            </Screen>
          )}
          {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
        </div>
        <ModalFooter hint={{ keys: ['↵'], label: step === DONE ? (rerun ? 'save' : 'open') : 'continue' }} className="pb-[calc(16px+env(safe-area-inset-bottom))] sm:px-8 sm:pb-5">
          {step === 0 ? (
            <Button variant="ghost" onClick={rerun ? closeSetup : skip} disabled={busy}>
              {rerun ? 'Cancel' : 'Skip setup'}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => (setError(null), setStep((s) => s - 1))} disabled={busy}>
              Back
            </Button>
          )}
          {step === 3 && !createdChannel && !channelName.trim() && <span className="text-[12px] text-fg-3">Optional</span>}
          <Button type="submit" variant="primary" busy={busy} disabled={!state}>
            {step === DONE ? (rerun ? 'Save' : 'Open Conductor') : step === 3 && !channelName.trim() && !createdChannel ? 'Skip' : 'Continue'}
          </Button>
        </ModalFooter>
      </form>
    </div>
  );
}

export function SavedNote({ path, install }: { path: string; install: SetupState['install'] }) {
  return (
    <p className="mt-3 text-[12px] text-fg-3" data-install={install}>
      Saved in <code className="font-mono">{path}</code>
      {offersNpmSetup(install, !!desktop) ? (
        <>
          , which stays out of git. Change it any time in Settings, or run <code className="font-mono">npm run setup</code>.
        </>
      ) : (
        '. Change it any time in Settings.'
      )}
    </p>
  );
}
