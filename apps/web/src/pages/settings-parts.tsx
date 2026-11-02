import { useEffect, useState, type ReactNode } from 'react';
import { PROVENANCE_LABEL, resettable, type Provenance } from '@omni/shared/settings-catalog.ts';
import type { ServerOption, ServerOptionsState } from '@omni/shared/settings.ts';
import { useApi } from '../api.ts';
import { Chip, ErrorNote, Icon, Label, Picker, Toggle, type ChipTone } from '../components/ui.tsx';
import { setSettingsScope, useSettingsScope } from '../settings-scope.ts';
import { useApp } from '../store.tsx';

// The pieces the Settings sections and channel settings share: a card, a labelled field, a status row, a switch
// row and the Advanced fold, plus the scope picker, the provenance chip beside a value and the .env options.

/** The DOM id a search result scrolls to (@omni/shared/settings-catalog.ts entries). */
export const settingAnchor = (entry: string) => `setting-${entry}`;

/**
 * Advanced: the developer and rarely changed items of a form, folded shut so the everyday ones stand alone (#405).
 * `open` forces it open, for a value Omni could not work out and needs typed. `title` names a fold that is not
 * Advanced (a long list). The Mac app's `AdvancedFold` matches.
 */
export function Advanced({ title = 'Advanced', summary, open: forced = false, children }: { title?: string; summary?: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(forced);
  useEffect(() => {
    if (forced) setOpen(true);
  }, [forced]);
  return (
    <section className="rounded-[20px] shadow-[inset_0_0_0_1px_var(--line)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-[20px] px-4 py-3 text-left hover:bg-surface md:px-5"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-fg-3" />
        <span className="shrink-0 font-display text-[15px]">{title}</span>
        {summary && !open && <span className="min-w-0 truncate text-[12.5px] text-fg-3">{summary}</span>}
      </button>
      {open && <div className="space-y-4 px-4 pt-1 pb-4 md:px-5 md:pb-5">{children}</div>}
    </section>
  );
}

/** A settings card. `entry`: the search entry it holds, so a result scrolls here. `origin`: a chip on the title's right. */
export function Card({ title, subtitle, entry, origin, children }: { title: string; subtitle?: ReactNode; entry?: string; origin?: ReactNode; children: ReactNode }) {
  return (
    <section id={entry && settingAnchor(entry)} className="scroll-mt-6 space-y-4 rounded-[20px] bg-surface p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px]">{title}</div>
          {subtitle && <p className="mt-0.5 text-[12.5px] text-fg-3">{subtitle}</p>}
        </div>
        {origin}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, hint, htmlFor, origin, children }: { label: string; hint?: string; htmlFor: string; origin?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor={htmlFor} hint={hint}>
            {label}
          </Label>
        </div>
        {origin}
      </div>
      {children}
    </div>
  );
}

const ORIGIN_TONE: Record<Provenance, ChipTone> = {
  default: 'outline',
  env: 'ink',
  machine: 'default',
  channel: 'live',
  inherited: 'outline',
  device: 'outline',
  mixed: 'outline',
};

/**
 * Where a value comes from (T3's provenance), with Reset beside a value Omni saved. `label` replaces the standard
 * wording, as "Set by OMNI_TZ" or "Set on #acme".
 */
export function Origin({ of, label, title, onReset, busy }: { of: Provenance; label?: string; title?: string; onReset?: () => void; busy?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <Chip tone={ORIGIN_TONE[of]} title={title}>
        {label ?? PROVENANCE_LABEL[of]}
      </Chip>
      {onReset && resettable(of) && (
        <button type="button" disabled={busy} onClick={onReset} className="text-[11.5px] text-fg-3 underline-offset-2 hover:text-fg hover:underline disabled:opacity-50">
          Reset
        </button>
      )}
    </span>
  );
}

/**
 * The scope picker of a scoped section: Every channel (this machine's values) or one channel. It stays picked from
 * section to section. A saved channel that is gone or archived shows as Every channel.
 */
export function useScopedChannel() {
  const { channels } = useApp();
  const scope = useSettingsScope();
  const listed = channels.filter((c) => !c.archived);
  const channel = listed.find((c) => c.id === scope) ?? null;
  return { channel, listed };
}

export function ScopeBar() {
  const { channel, listed } = useScopedChannel();
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
      <span>Scope</span>
      <Picker
        label="Settings scope"
        value={channel?.id ?? ''}
        onChange={setSettingsScope}
        searchable={listed.length > 7}
        options={[
          { value: '', label: 'Every channel', sub: 'Machine-wide values', icon: 'monitor', avatar: false },
          ...listed.map((c) => ({ value: c.id, label: c.id === 'conductor' ? 'Conductor' : `#${c.name}`, channelIcon: c.icon })),
        ]}
      />
      <span className="max-sm:basis-full">{channel ? 'Showing what this channel sets and what it inherits.' : "Showing this machine's values. Pick a channel to see its own."}</span>
    </div>
  );
}

/**
 * The .env options for one section, read-only with where each value came from. The server reads them at start, so a
 * change goes in .env followed by a restart.
 */
export function ServerOptions({ section, entry, title = 'Server options' }: { section: ServerOption['section']; entry?: string; title?: string }) {
  const res = useApi<ServerOptionsState>('/setup/server');
  const rows = res.data?.options.filter((o) => o.section === section) ?? [];
  if (res.error) return <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>;
  if (!res.data || rows.length === 0) return null;
  const set = rows.filter((o) => o.source === 'env').length;
  return (
    <Advanced title={title} summary={set ? `${set} set in .env` : 'All built-in defaults'}>
      <div id={entry && settingAnchor(entry)} className="scroll-mt-6 space-y-3">
        <p className="text-[12.5px] text-fg-3">
          Read from <code>.env</code> or the environment when the server starts. Change one there and restart the server.
        </p>
        <ul className="divide-y divide-line">
          {rows.map((o) => (
            <li key={o.env} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1 basis-56">
                <div className="text-[13px] font-medium">{o.label}</div>
                <p className="mt-0.5 text-[12px] text-fg-3">{o.hint}</p>
                <code className="mt-0.5 block text-[11.5px] text-fg-3">{o.env}</code>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono text-[12.5px]">{o.value}</span>
                <Origin of={o.source} title={o.source === 'env' ? `Built-in default: ${o.default}` : undefined} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Advanced>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-20 shrink-0 text-fg-3">{label}</span>
      {children}
    </div>
  );
}

export function SwitchRow({ title, detail, checked, onChange, disabled, origin }: { title: string; detail: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; origin?: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium">{title}</span>
          {origin}
        </div>
        <p className="mt-0.5 text-[12.5px] text-fg-3">{detail}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}
