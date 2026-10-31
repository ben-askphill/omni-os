import { useEffect, useState, type FormEvent } from 'react';
import { NAME_MAX } from '@omni/shared/settings.ts';
import { api, errorText, type SetupState, type UserConfigPatch } from '../api.ts';
import { navigate, href } from '../router.ts';
import { useApp } from '../store.tsx';
import { OmniMark } from './brand.tsx';
import { HarnessScreen, PronounsInput, Row, Screen, Steps, Summary, TimezoneInput, browserTimezone, createChannel } from './onboarding-parts.tsx';
import { Button, ErrorNote } from './ui.tsx';

export { PronounsInput, TimezoneInput } from './onboarding-parts.tsx';

// Onboarding: five short screens on first run (no data/omni.config.json yet), or again from Settings. It writes the
// user config through /api/setup; the Mac app (OnboardingSheet.swift) and `npm run setup` ask the same questions.

export { NAME_MAX };

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
