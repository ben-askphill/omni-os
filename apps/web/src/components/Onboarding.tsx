import { useState, type FormEvent } from 'react';
import { errorText } from '../api.ts';
import { OmniMark } from './brand.tsx';
import { Button, ErrorNote } from './ui.tsx';
import { readPref, useApp, writePref } from '../store.tsx';
import { NAME_MAX } from '../pages/Settings.tsx';

// The first-run step: once per server, until a name is saved. Skipping hides it in this browser only; the
// Settings page still takes a name later. The Mac app shows the same (OnboardingSheet.swift).

const SKIP_KEY = 'onboarding.skipped';

export function Onboarding() {
  const { profile, saveProfile } = useApp();
  const [skipped, setSkipped] = useState(() => readPref(SKIP_KEY, false));
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile || profile.name || skipped) return null;

  const skip = () => {
    writePref(SKIP_KEY, true);
    setSkipped(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name, or skip for now.');
    setSaving(true);
    setError(null);
    try {
      await saveProfile({ name: trimmed });
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <div className="scrim fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <form
        onSubmit={save}
        className="modal-in w-full rounded-t-[28px] bg-elev p-6 pb-[calc(24px+env(safe-area-inset-bottom))] shadow-[var(--shadow-menu)] sm:max-w-md sm:rounded-[28px] sm:p-8"
      >
        <OmniMark size={36} state="idle" />
        <div className="caption mt-5 mb-2">Welcome to Omni</div>
        <h2 id="onboarding-title" className="font-display text-[24px] leading-[1.1]">
          What should Omni call you?
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-3">Your name goes in the greeting and is told to every agent, so a thread knows who it works for. Change it any time in Settings.</p>
        <input
          className="field mt-5 w-full"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="name"
          placeholder="Your name"
          data-autofocus
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={skip}>
            Skip for now
          </Button>
          <Button type="submit" variant="primary" busy={saving}>
            Continue
          </Button>
        </div>
      </form>
    </div>
  );
}
