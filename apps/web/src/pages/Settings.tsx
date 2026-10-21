import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorText, type SetupState, type UserConfigPatch } from '../api.ts';
import { NAME_MAX, PronounsInput, TimezoneInput } from '../components/Onboarding.tsx';
import { Button, ErrorNote, Icon, Label, Loading, PageHeader } from '../components/ui.tsx';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';

// Settings: the user config (data/omni.config.json) that onboarding wrote. Who you are, where your work lives and
// the optional integrations. The Mac app's Profile tab (apps/mac/Omni/ProfileSettingsView.swift) edits the same file.

export { NAME_MAX };

export function SettingsPage() {
  const { openSetup, setupOpen } = useApp();
  const [state, setState] = useState<SetupState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read again when the wizard closes, since it may have changed everything.
  useEffect(() => {
    if (setupOpen) return;
    api
      .get<SetupState>('/setup')
      .then(setState)
      .catch((err) => setError(errorText(err)));
  }, [setupOpen]);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader width="max-w-2xl" title="Settings" subtitle="Who you are, where your work lives, and what Omni connects to." />
      <div className="mx-auto max-w-2xl space-y-5 px-4 pt-5 pb-16 md:px-8">
        {error && <ErrorNote>{error}</ErrorNote>}
        {state ? <SettingsForm state={state} onSaved={setState} /> : !error && <Loading />}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-surface p-4 md:p-5">
          <div className="min-w-0">
            <div className="font-display text-[15px]">Setup</div>
            <p className="mt-0.5 text-[12.5px] text-fg-3">Walk through the onboarding screens again, including the harness check.</p>
          </div>
          <Button onClick={openSetup}>Run setup again</Button>
        </div>
        <div className="flex gap-3 rounded-[20px] bg-surface p-4 text-[12.5px] leading-relaxed text-fg-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
            <Icon name="info" size={15} />
          </span>
          <div>
            These settings live in <code>{state?.path ?? 'data/omni.config.json'}</code> on this machine and never go into git, so a fork stays clean. Secrets,
            sync and automations have their own pages: <a className="underline" href={href.secrets()}>Secrets</a>, <a className="underline" href={href.sync()}>Sync</a> and{' '}
            <a className="underline" href={href.automations()}>Automations</a>. Server options such as the port and model defaults live in <code>.env</code>.
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsForm({ state, onSaved }: { state: SetupState; onSaved: (s: SetupState) => void }) {
  const { reloadProfile } = useApp();
  const c = state.config;
  const [name, setName] = useState(c.user.name);
  const [pronouns, setPronouns] = useState(c.user.pronouns);
  const [email, setEmail] = useState(c.user.email);
  const [timezone, setTimezone] = useState(c.user.timezone);
  const [root, setRoot] = useState(c.workspace.root);
  const [reposDir, setReposDir] = useState(c.workspace.reposDir);
  const [githubOwner, setGithubOwner] = useState(c.workspace.githubOwner);
  const [hermesUrl, setHermesUrl] = useState(c.integrations.hermesUrl);
  const [centralBrainDir, setCentralBrainDir] = useState(c.integrations.centralBrainDir);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The Mac app or `npm run setup` can change the file while this page is open.
  useEffect(() => {
    setName(c.user.name);
    setPronouns(c.user.pronouns);
    setEmail(c.user.email);
    setTimezone(c.user.timezone);
    setRoot(c.workspace.root);
    setReposDir(c.workspace.reposDir);
    setGithubOwner(c.workspace.githubOwner);
    setHermesUrl(c.integrations.hermesUrl);
    setCentralBrainDir(c.integrations.centralBrainDir);
  }, [c]);

  const patch: UserConfigPatch = {
    user: { name: name.trim(), pronouns: pronouns.trim() || 'they/them', email: email.trim(), timezone: timezone.trim() },
    workspace: { root: root.trim(), reposDir: reposDir.trim(), githubOwner: githubOwner.trim() },
    integrations: { hermesUrl: hermesUrl.trim(), centralBrainDir: centralBrainDir.trim() },
  };
  const dirty = JSON.stringify(patch) !== JSON.stringify({ user: c.user, workspace: c.workspace, integrations: c.integrations });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter a name.');
    if (name.trim().length > NAME_MAX) return setError(`Keep it under ${NAME_MAX} characters.`);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await api.put<SetupState>('/setup', patch));
      await reloadProfile();
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const edited = () => setSaved(false);
  const field = (set: (v: string) => void) => (e: { target: { value: string } }) => (set(e.target.value), edited());

  return (
    <form onSubmit={save} className="space-y-5">
      <Card title="You">
        <Row label="Name" htmlFor="set-name" hint="Used in the greeting on Home and told to every agent, so a thread knows who it works for.">
          <input id="set-name" className="field w-full max-w-sm" value={name} maxLength={NAME_MAX} autoComplete="name" placeholder="Your name" onChange={field(setName)} />
        </Row>
        <div className="grid gap-4 sm:grid-cols-2">
          <Row label="Pronouns" htmlFor="set-pronouns">
            <PronounsInput id="set-pronouns" value={pronouns} onChange={(v) => (setPronouns(v), edited())} />
          </Row>
          <Row label="Timezone" htmlFor="set-tz" hint={`Empty uses the server's: ${state.fallbacks.timezone}.`}>
            <TimezoneInput id="set-tz" value={timezone} onChange={(v) => (setTimezone(v), edited())} />
          </Row>
        </div>
        <Row label="Email" htmlFor="set-email">
          <input id="set-email" className="field w-full max-w-sm" type="email" value={email} autoComplete="email" placeholder="you@example.com" onChange={field(setEmail)} />
        </Row>
      </Card>
      <Card title="Workspace">
        <Row label="Workspace folder" htmlFor="set-root" hint="Threads without a repo run here; its CLAUDE.md and skills load in every Claude thread.">
          <input id="set-root" className="field w-full font-mono !text-[13px]" value={root} placeholder={state.fallbacks.workspaceRoot} spellCheck={false} onChange={field(setRoot)} />
        </Row>
        <Row label="Repos folder" htmlFor="set-repos">
          <input id="set-repos" className="field w-full font-mono !text-[13px]" value={reposDir} placeholder={state.fallbacks.reposDir} spellCheck={false} onChange={field(setReposDir)} />
        </Row>
        <Row label="GitHub owner" htmlFor="set-gh" hint="Your GitHub user or org.">
          <input id="set-gh" className="field w-full max-w-sm font-mono !text-[13px]" value={githubOwner} placeholder="octocat" spellCheck={false} autoCapitalize="off" onChange={field(setGithubOwner)} />
        </Row>
      </Card>
      <Card title="Integrations" subtitle="Optional. Leave a field empty to turn it off.">
        <Row label="Hermes URL" htmlFor="set-hermes" hint="A Hermes API server on your tailnet. Its token is the Keychain secret HERMES_API_KEY.">
          <input id="set-hermes" className="field w-full font-mono !text-[13px]" value={hermesUrl} placeholder="http://100.64.0.1:8642" spellCheck={false} onChange={field(setHermesUrl)} />
        </Row>
        <Row label="Central brain folder" htmlFor="set-brain" hint="A git repo of notes that the brain-nightly automation exports thread digests into.">
          <input id="set-brain" className="field w-full font-mono !text-[13px]" value={centralBrainDir} placeholder="~/central-brain" spellCheck={false} onChange={field(setCentralBrainDir)} />
        </Row>
      </Card>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>
          Save
        </Button>
        {saved && !dirty && <span className="text-[12.5px] text-fg-3">Saved</span>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </form>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-[20px] bg-surface p-4 md:p-5">
      <div>
        <div className="font-display text-[15px]">{title}</div>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-fg-3">{subtitle}</p>}
      </div>
      {children}
    </section>
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
