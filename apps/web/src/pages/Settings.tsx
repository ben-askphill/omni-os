import { useEffect, useState, type FormEvent } from 'react';
import { errorText } from '../api.ts';
import { Button, ErrorNote, Icon, Label, Loading, PageHeader } from '../components/ui.tsx';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';

// Settings: who uses this Omni. The name goes into the Home greeting and into every agent's prompt, so threads
// know who they work for. The Mac app's Profile tab (apps/mac/Omni/ProfileSettingsView.swift) edits the same row.

export const NAME_MAX = 60;

export function SettingsPage() {
  const { profile } = useApp();
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader width="max-w-2xl" title="Settings" subtitle="How Omni and its agents address you." />
      <div className="mx-auto max-w-2xl space-y-5 px-4 pt-5 pb-16 md:px-8">
        {profile ? <NameCard /> : <Loading />}
        <div className="flex gap-3 rounded-[20px] bg-surface p-4 text-[12.5px] leading-relaxed text-fg-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
            <Icon name="info" size={15} />
          </span>
          <div>
            Secrets, sync and automations have their own pages: <a className="underline" href={href.secrets()}>Secrets</a>,{' '}
            <a className="underline" href={href.sync()}>Sync</a> and <a className="underline" href={href.automations()}>Automations</a>. Server options such as
            the port, model defaults and the brain folder live in <code>.env</code> next to the repo.
          </div>
        </div>
      </div>
    </div>
  );
}

function NameCard() {
  const { profile, saveProfile } = useApp();
  const [name, setName] = useState(profile?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The other Mac or the Mac app can change it while this page is open.
  useEffect(() => setName(profile?.name ?? ''), [profile?.name]);

  const trimmed = name.trim();
  const dirty = trimmed !== (profile?.name ?? '');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) return setError('Enter a name.');
    if (trimmed.length > NAME_MAX) return setError(`Keep it under ${NAME_MAX} characters.`);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveProfile({ name: trimmed });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="rounded-[20px] bg-surface p-4 md:p-5">
      <div className="mb-3 font-display text-[15px]">You</div>
      <Label htmlFor="profile-name" hint="Used in the greeting on Home and told to every agent, so a thread knows who it works for.">
        Name
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="profile-name"
          className="field max-w-xs flex-1"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="name"
          placeholder="Your name"
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
        <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>
          Save
        </Button>
        {saved && !dirty && <span className="text-[12.5px] text-fg-3">Saved</span>}
      </div>
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
    </form>
  );
}
