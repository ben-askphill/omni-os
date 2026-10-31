// The pieces the onboarding wizard (Onboarding.tsx) is built from: the screen frame, the form row, the step dots, the
// harness check, and the timezone and pronoun fields Settings reuses.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type HarnessWithRunning } from '../api.ts';
import { Button, CopyButton, Icon, Label } from './ui.tsx';

export const PRONOUNS = ['they/them', 'she/her', 'he/him'];
export const STEPS = ['You', 'Workspace', 'Harnesses', 'Channel', 'Done'] as const;

type HarnessRow = HarnessWithRunning & { install?: string };

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

export function HarnessScreen() {
  const [list, setList] = useState<HarnessRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const load = async () => {
    setChecking(true);
    try {
      // Hermes and Cursor Cloud run off this Mac: listed once they work, never as something to install.
      setList((await api.get<HarnessRow[]>('/harnesses')).filter((h) => (h.id !== 'hermes' && h.id !== 'cursor-cloud') || h.available));
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

export function Steps({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
      {STEPS.map((s, i) => (
        <li key={s} title={s} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-fg' : i < step ? 'w-1.5 bg-fg-2' : 'w-1.5 bg-line-strong'}`} />
      ))}
    </ol>
  );
}

export function Screen({ caption, title, body, children }: { caption: string; title: string; body: string; children: ReactNode }) {
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
