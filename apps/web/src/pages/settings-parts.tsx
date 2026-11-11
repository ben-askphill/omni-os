import { useEffect, useState, type ReactNode } from 'react';
import { PROVENANCE_LABEL, resettable, type Provenance } from '@omni/shared/settings-catalog.ts';
import type { ServerOption, ServerOptionsState } from '@omni/shared/settings.ts';
import { useApi } from '../api.ts';
import { Button, ErrorNote, Icon, Picker, Toggle } from '../components/ui.tsx';
import { setSettingsScope, useSettingsScope } from '../settings-scope.ts';
import { useApp } from '../store.tsx';

// The pieces every Settings section and channel settings share: one card (filled; only a fold is outlined), a stacked
// field row, an inline setting row, one provenance chip on the label line, Reset as a small ghost button, the .env
// note on a field .env sets, one key-value list, a danger row with its consequence, a one-line link to the page that
// holds a setting, the scope picker and the .env server options.

/** The DOM id a search result scrolls to (@omni/shared/settings-catalog.ts entries). */
export const settingAnchor = (entry: string) => `setting-${entry}`;

/**
 * A fold: the developer and rarely changed items of a form, folded shut so the everyday ones stand alone (#405).
 * `open` forces it open, for a value Omni could not work out and needs typed. The only outlined card.
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
        <span className="shrink-0 font-display text-[15px] font-medium">{title}</span>
        {summary && !open && <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-fg-3">{summary}</span>}
      </button>
      {open && <div className="space-y-4 px-4 pt-1 pb-4 md:px-5 md:pb-5">{children}</div>}
    </section>
  );
}

/** A settings card. `entry`: the search entry it holds, so a result scrolls here. `actions`: buttons on the title's right. */
export function Card({ title, subtitle, entry, actions, children }: { title: ReactNode; subtitle?: ReactNode; entry?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <section id={entry && settingAnchor(entry)} className="scroll-mt-6 space-y-4 rounded-[20px] bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="font-display text-[15px] font-medium">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12.5px] text-fg-3">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** The id of a Row's hint, for the control's aria-describedby. */
export const rowHintId = (htmlFor: string) => `${htmlFor}-hint`;

/**
 * A labelled field, stacked: the label with its provenance chip, Reset on the right, the hint under them, then the
 * control at the row's full width. The label line is a button tall with or without Reset, so rows keep one rhythm.
 */
export function Row({ label, hint, htmlFor, origin, action, children }: { label: string; hint?: ReactNode; htmlFor: string; origin?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5">
        <div className="flex min-h-7 items-center gap-2">
          <label htmlFor={htmlFor} className="min-w-0 text-[13px] font-medium text-fg">
            {label}
          </label>
          {origin}
          <span className="flex-1" />
          {action}
        </div>
        {hint && (
          <p id={rowHintId(htmlFor)} className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3">
            {hint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/** A setting on one line: its label, chip and hint on the left, the control on the right. */
export function SettingRow({ label, hint, origin, control }: { label: ReactNode; hint?: ReactNode; origin?: ReactNode; control?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex min-h-5 flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{label}</span>
          {origin}
        </div>
        {hint && <p className="mt-0.5 text-[12.5px] text-fg-3">{hint}</p>}
      </div>
      {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
    </div>
  );
}

/** A switch on one line. The switch's accessible name is the visible title. */
export function SwitchRow({ title, detail, checked, onChange, disabled, origin }: { title: string; detail?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; origin?: ReactNode }) {
  return <SettingRow label={title} hint={detail} origin={origin} control={<Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />} />;
}

/**
 * Where a value comes from (T3's provenance): one outlined chip beside the label. `label` replaces the standard
 * wording, as "Set on #acme". A built-in default is plain text, so a chip always means someone set the value.
 */
export function Origin({ of, label, title }: { of: Provenance; label?: string; title?: string }) {
  const text = label ?? PROVENANCE_LABEL[of];
  if (of === 'default')
    return (
      <span title={title} className="inline-flex h-5 shrink-0 items-center text-[11.5px] whitespace-nowrap text-fg-3">
        {text}
      </span>
    );
  return (
    <span title={title} className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap text-fg-3 shadow-[inset_0_0_0_1px_var(--line-strong)]">
      {text}
    </span>
  );
}

/** Reset beside a value Omni saved: a small ghost button, shown only where a reset can clear it. */
export function ResetButton({ of, onReset, busy }: { of: Provenance; onReset: () => void; busy?: boolean }) {
  if (!resettable(of)) return null;
  return (
    <Button size="sm" variant="ghost" busy={busy} onClick={onReset}>
      Reset
    </Button>
  );
}

/** Under a field .env or the config file sets: where to change it, since the page cannot. */
export function EnvNote({ env, file }: { env?: string; file?: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-fg-3">
      <Icon name="lock" size={13} className="mt-[3px] shrink-0" />
      <span>
        {env ? (
          <>
            Set in .env as <code className="font-mono text-[12px] text-fg-2">{env}</code>. Change it there and restart the server.
          </>
        ) : (
          <>
            Set in <code className="font-mono text-[12px] text-fg-2">data/omni.config.json</code>
            {file && (
              <>
                {' '}as <code className="font-mono text-[12px] text-fg-2">{file}</code>
              </>
            )}
            .
          </>
        )}
      </span>
    </p>
  );
}

/** One key-value list, one label width, so every section's values start on the same line. */
export function InfoList({ children }: { children: ReactNode }) {
  return <div className="space-y-2 text-[13px]">{children}</div>;
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-6 min-w-0 items-center gap-2">
      <span className="w-[120px] shrink-0 text-fg-3 max-sm:w-24">{label}</span>
      {children}
    </div>
  );
}

/** The class that gives an InlineConfirm the danger label while it waits to be asked. */

/** A destructive action: what it costs, said before the button, then the button and its confirm step. */
export function DangerRow({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
      <p className="min-w-0 flex-1 basis-56 text-[12.5px] text-fg-3">{children}</p>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/** A setting whose home is another page: one line linking there. */
export function LinkLine({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="px-1 text-[13px] text-fg-3">
      <a href={href} className="inline-flex items-center gap-1 font-medium text-fg-2 hover:text-fg">
        {children}
        <Icon name="arrowRight" size={13} />
      </a>
    </p>
  );
}

/** A note at the foot of a section. */
export function FootNote({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[12.5px] leading-relaxed text-fg-3">{children}</p>;
}

/** The save line of a form that saves as you go. */
export function AutosaveNote({ saving, saved }: { saving: boolean; saved: boolean }) {
  return (
    <p className="text-right text-[12.5px] text-fg-3" role="status">
      Each field saves when you press Return or leave it.{saving ? ' Saving…' : saved ? ' Saved.' : ''}
    </p>
  );
}

/**
 * The scope picker of a scoped section: This machine (its values) or one channel. It stays picked from section to
 * section. A saved channel that is gone or archived shows as This machine.
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
  // One option is no choice.
  if (!listed.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
      <span>Showing</span>
      <Picker
        label="Showing values for"
        value={channel?.id ?? ''}
        onChange={setSettingsScope}
        searchable={listed.length > 7}
        options={[
          { value: '', label: 'This machine', sub: 'Values every channel starts from', icon: 'monitor', avatar: false },
          ...listed.map((c) => ({ value: c.id, label: c.id === 'conductor' ? 'Conductor' : `#${c.name}`, avatarBg: c.avatar_bg, channelIcon: c.icon })),
        ]}
      />
      <span className="max-sm:basis-full">{channel ? 'What this channel sets and what it inherits.' : 'Pick a channel to see and change its own values.'}</span>
    </div>
  );
}

/**
 * The .env options for one section, read-only with where each value came from, in the fold every section names the
 * same way. The server reads them at start, so a change goes in .env (the data dir's in the desktop app,
 * apps/server/config.ts) followed by a restart.
 */
export function ServerOptions({ section, entry }: { section: ServerOption['section']; entry?: string }) {
  const res = useApi<ServerOptionsState>('/setup/server');
  const rows = res.data?.options.filter((o) => o.section === section) ?? [];
  if (res.error) return <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>;
  if (!res.data || rows.length === 0) return null;
  const set = rows.filter((o) => o.source === 'env').length;
  return (
    <Advanced title={`Server options · ${set} set in .env`} summary={SERVER_OPTIONS_SUMMARY[section]}>
      <div id={entry && settingAnchor(entry)} className="scroll-mt-6 space-y-3">
        <p className="text-[12.5px] text-fg-3">
          Read from <code>.env</code> or the environment when the server starts. The desktop app reads the <code>.env</code> in
          its data folder, a checkout the one at the repo root. Change one there and restart the server.
        </p>
        <ul className="divide-y divide-line">
          {rows.map((o) => (
            <li key={o.env} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1 basis-56">
                <div className="text-[13px] font-medium">{o.label}</div>
                <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3">{o.hint}</p>
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

const SERVER_OPTIONS_SUMMARY: Record<ServerOption['section'], string> = {
  models: 'Claude Code binary, fallback model and permission mode',
  threads: 'Sessions, usage limits and thread features',
  worktrees: 'When a merged worktree counts as idle',
  machines: 'Port and host',
};
