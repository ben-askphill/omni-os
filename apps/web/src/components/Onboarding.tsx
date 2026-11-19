import { useEffect, useRef, useState, type FormEvent } from 'react';
import { githubLine, type GithubCheck } from '@omni/shared/github-check.ts';
import { HARNESS_CHECK_LABEL } from '@omni/shared/harness-check.ts';
import { toolsAddOn } from '@omni/shared/onboarding.ts';
import { NAME_MAX } from '@omni/shared/settings.ts';
import { STARTER_AUTOMATIONS } from '@omni/shared/starter-automations.ts';
import { api, errorText, type SetupState, type UserConfigPatch } from '../api.ts';
import { desktop } from '../desktop.ts';
import { useLayout } from '../layout-pref.ts';
import { navigate, href } from '../router.ts';
import { useApp, useIsMobile } from '../store.tsx';
import { OmniMark } from './brand.tsx';
import {
  FilesScreen,
  HarnessScreen,
  NotificationsScreen,
  PronounsInput,
  RoutinesScreen,
  Row,
  STEPS,
  Screen,
  Steps,
  Summary,
  TimezoneInput,
  WorkScreen,
  browserTimezone,
  createChannel,
} from './onboarding-parts.tsx';
import { Button, ErrorNote, fieldHintId, FolderInput, IDENTIFIER } from './ui.tsx';
import { ModalFooter } from './ui/modal.tsx';
import { useModalDialog } from './ui/use-modal-dialog.ts';
import { isImeEnter } from '../ime.ts';

export { PronounsInput, TimezoneInput } from './onboarding-parts.tsx';

// Onboarding: short screens on first run (no data/omni.config.json yet), or again from Settings: who you are, what you
// do and which tools you use, where Omni keeps your files (code and a store are add-ons), the harnesses, a first
// project, notifications, and a first question that opens on its answer. It writes the user config through
// /api/setup. In a checkout, `npm run setup` asks the core of it.

/** The screens by name, so moving one moves its index too. */
const STEP = Object.fromEntries(STEPS.map((s, i) => [s, i])) as Record<(typeof STEPS)[number], number>;
/** The last screen, which saves. */
const DONE = STEP.Done;

/** Where to add a channel later, in the layout this wizard opened over. */
export function addChannelHint(where: 'phone' | 'rail' | 'classic') {
  if (where === 'phone') return 'Skip it and add projects later in Settings > Channels.';
  if (where === 'rail') return 'Skip it and add projects later with Add channel (+) at the foot of the rail.';
  return 'Skip it and add projects later with Add channel in the sidebar.';
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
    { id: 'phone', text: 'Add your phone: scan the code in Settings > Sharing & access > Pair a phone.' },
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
  // No onDismiss: Escape and the backdrop leave setup open. Skip setup and Cancel are the ways out.
  const dialog = useRef<HTMLDialogElement>(null);
  const { ready, dialogProps } = useModalDialog(dialog);
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
  const [work, setWork] = useState('');
  const [tools, setTools] = useState('');
  const [files, setFiles] = useState({ root: '', reposDir: '', githubOwner: '' });
  /** The code add-on (repo folders, a GitHub owner): null until the user turns it on or off here. */
  const [codeChoice, setCodeChoice] = useState<boolean | null>(null);
  const [ask, setAsk] = useState('');
  /** The starter routines turned on in the Routines step; made when setup finishes. */
  const [starters, setStarters] = useState<string[]>([]);
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
        setWork(s.config.user.work ?? '');
        setTools(s.config.user.tools ?? '');
        // The owner is not guessed from this checkout's remote: a clone of someone else's repo would name them.
        setFiles({ root: s.config.workspace.root, reposDir: s.config.workspace.reposDir, githubOwner: s.config.workspace.githubOwner });
      })
      .catch((err) => setError(errorText(err)));
  }, []);

  const rerun = !!state?.onboarded;
  // Open when GitHub was picked or a repo field is already saved, until the user says otherwise.
  const code = codeChoice ?? (toolsAddOn(tools, 'code') || !!state?.config.workspace.reposDir || !!state?.config.workspace.githubOwner);
  const store = toolsAddOn(tools, 'store');
  // The GitHub CLI's login fills an empty GitHub owner, since that is whose repos these are.
  const heardGithub = (g: GithubCheck | null) => {
    setGithub(g);
    const login = g?.state === 'ready' ? g.login : '';
    if (login) setFiles((f) => (f.githubOwner ? f : { ...f, githubOwner: login }));
  };

  const patch = (): UserConfigPatch => ({
    user: {
      name: name.trim().replace(/\s+/g, ' '),
      email: email.trim(),
      timezone: timezone.trim(),
      pronouns: pronouns.trim() || 'they/them',
      work: work.trim().replace(/\s+/g, ' '),
      tools: tools.trim(),
    },
    // Without the code add-on the repo fields stay as saved, so turning it off loses nothing.
    workspace: code ? { root: files.root.trim(), reposDir: files.reposDir.trim(), githubOwner: files.githubOwner.trim() } : { root: files.root.trim() },
  });

  // Each step saves what it asked, so a closed tab keeps the answers. The last one marks onboarding done.
  const save = async () => setState(await api.put<SetupState>('/setup', patch()));

  const finish = async (body: UserConfigPatch & { ask?: string; starters?: string[] }) => {
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
      if (step === STEP.You || step === STEP.Work || step === STEP.Files) await save();
      if (step === STEP.Project && channelName.trim() && !createdChannel) {
        setCreatedChannel(await createChannel(channelName, code ? channelRepo : '', store ? channelStore : ''));
        reloadChannels();
      }
      if (step === DONE) return await finish({ ...patch(), ask: rerun ? undefined : ask.trim() || undefined, ...(starters.length > 0 && { starters }) });
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
    <dialog
      ref={dialog}
      aria-labelledby="onboarding-title"
      {...dialogProps}
      className="modal modal-in max-h-[100dvh] w-full overflow-hidden rounded-t-[var(--r-3xl)] p-0 sm:max-h-[min(720px,calc(100dvh-48px))] sm:w-[calc(100%-48px)] sm:max-w-lg sm:rounded-[var(--r-3xl)]"
    >
      {ready && (
        <form onSubmit={next} className="flex max-h-[100dvh] flex-col sm:max-h-[min(720px,calc(100dvh-48px))]">
          <div className="flex items-center justify-between gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
            <OmniMark size={32} />
            <Steps step={step} />
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6 sm:px-8">
            {!state && !error && <p className="py-10 text-center text-[13px] text-fg-3">Loading…</p>}
            {state && step === 0 && (
              <Screen caption={rerun ? 'Setup' : 'Welcome to Omni'} title="Who are you?" body="Your name and pronouns are told to every agent, so a thread knows who it works for. Automations use your timezone.">
                <Row label="Name" htmlFor="ob-name" hint="Agents address you by this name.">
                  <input id="ob-name" aria-describedby={fieldHintId('ob-name')} className="field w-full" value={name} maxLength={NAME_MAX} autoComplete="name" placeholder="Your name" autoFocus onChange={(e) => setName(e.target.value)} />
                </Row>
                <Row label="Email" htmlFor="ob-email" hint="Optional. Agents use it to recognise your own commits, PRs and mail.">
                  <input id="ob-email" aria-describedby={fieldHintId('ob-email')} className="field w-full" type="email" value={email} autoComplete="email" placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
                </Row>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Row label="Timezone" htmlFor="ob-tz" hint="Prefilled from this device.">
                    <TimezoneInput id="ob-tz" describedBy={fieldHintId('ob-tz')} value={timezone} onChange={setTimezone} />
                  </Row>
                  <Row label="Pronouns" htmlFor="ob-pronouns" hint="Used when agents mention you.">
                    <PronounsInput id="ob-pronouns" describedBy={fieldHintId('ob-pronouns')} value={pronouns} onChange={setPronouns} />
                  </Row>
                </div>
              </Screen>
            )}
            {state && step === STEP.Work && <WorkScreen work={work} tools={tools} onWork={setWork} onTools={setTools} />}
            {state && step === STEP.Files && (
              <FilesScreen value={files} onChange={(v) => setFiles((f) => ({ ...f, ...v }))} code={code} onCode={setCodeChoice} fallbacks={state.fallbacks} />
            )}
            {state && step === STEP.Harnesses && <HarnessScreen onGithub={heardGithub} code={code} />}
            {state && step === STEP.Project && (
              <Screen
                caption="First project"
                title="Add a project or client"
                body={`Each project gets a channel of its own for its threads, files and notes. Quick questions that belong to no project go to General. ${addChannelHint(phone ? 'phone' : layout)}`}
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
                    {code && (
                      <Row label="Repo folder" htmlFor="ob-ch-repo" hint="Optional. A git checkout on this machine; every thread gets its own copy.">
                        <FolderInput
                          id="ob-ch-repo"
                          aria-describedby={fieldHintId('ob-ch-repo')}
                          dialogTitle="Repo folder"
                          value={channelRepo}
                          placeholder={`${state.resolved.reposDir}/acme-site`}
                          onChange={setChannelRepo}
                        />
                      </Row>
                    )}
                    {store && (
                      <Row label="Shopify store" htmlFor="ob-ch-store" hint="Optional. The myshopify domain.">
                        <input id="ob-ch-store" aria-describedby={fieldHintId('ob-ch-store')} {...IDENTIFIER} className="field field-mono w-full" inputMode="url" value={channelStore} placeholder="acme.myshopify.com" onChange={(e) => setChannelStore(e.target.value)} />
                      </Row>
                    )}
                  </>
                )}
              </Screen>
            )}
            {state && step === STEP.Notifications && <NotificationsScreen />}
            {state && step === STEP.Routines && <RoutinesScreen value={starters} onChange={setStarters} />}
            {state && step === DONE && (
              <Screen
                caption="Done"
                title={`You're set${name.trim() ? `, ${name.trim().split(' ')[0]}` : ''}`}
                body={
                  rerun
                    ? 'Save to keep these settings.'
                    : 'Ask a first question and Omni opens on the answer, in General. Or leave it empty: the Conductor waits in #conductor with a welcome message, and hands bigger work to the right crew role.'
                }
              >
                {!rerun && (
                  <Row label="Your first question" htmlFor="ob-ask" hint="Optional. Anything you would ask a capable assistant.">
                    <textarea
                      id="ob-ask"
                      aria-describedby={fieldHintId('ob-ask')}
                      className="field min-h-[64px] w-full resize-y"
                      rows={2}
                      value={ask}
                      placeholder="What should I check before I sign a lease for an office?"
                      onChange={(e) => setAsk(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !isImeEnter(e)) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                  </Row>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-[16px] bg-surface p-4 text-[13px]">
                  <Summary k="Name" v={name.trim()} />
                  <Summary k="Pronouns" v={pronouns} />
                  <Summary k="Timezone" v={timezone || state.resolved.timezone} />
                  {work.trim() && <Summary k="Work" v={work.trim()} />}
                  {tools.trim() && <Summary k="Tools" v={tools.trim()} />}
                  <Summary k="Files" v={files.root || state.fallbacks.workspaceRoot} mono />
                  {code && <Summary k="GitHub" v={files.githubOwner || 'not set'} mono />}
                  {code && github && <Summary k="GitHub CLI" v={githubLine(github) ?? HARNESS_CHECK_LABEL[github.state]} />}
                  {createdChannel && <Summary k="Channel" v={`#${createdChannel}`} />}
                  {starters.length > 0 && <Summary k="Routines" v={STARTER_AUTOMATIONS.filter((s) => starters.includes(s.id)).map((s) => s.name).join(', ')} />}
                </dl>
                <SavedNote path={state.path} install={state.install} />
                {!rerun && <DoneTips tips={doneTips(state.install, phone ? 'phone' : layout)} />}
              </Screen>
            )}
            {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
          </div>
          <ModalFooter hint={{ keys: ['↵'], label: step === DONE ? (rerun ? 'save' : ask.trim() ? 'ask' : 'open') : 'continue' }} className="pb-[calc(16px+env(safe-area-inset-bottom))] sm:px-8 sm:pb-5">
            {step === 0 ? (
              <Button variant="ghost" onClick={rerun ? closeSetup : skip} disabled={busy}>
                {rerun ? 'Cancel' : 'Skip setup'}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => (setError(null), setStep((s) => s - 1))} disabled={busy}>
                Back
              </Button>
            )}
            {step === STEP.Project && !createdChannel && !channelName.trim() && <span className="text-[12px] text-fg-3">Optional</span>}
            <Button type="submit" variant="primary" busy={busy} disabled={!state}>
              {step === DONE ? (rerun ? 'Save' : ask.trim() ? 'Ask' : 'Open Conductor') : step === STEP.Project && !channelName.trim() && !createdChannel ? 'Skip' : 'Continue'}
            </Button>
          </ModalFooter>
        </form>
      )}
    </dialog>
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
