import { useState, type ReactNode } from 'react';
import { api, errorText, harnessesPath, useApi, type Channel, type HarnessWithRunning } from '../api.ts';
import { HarnessLogo } from '../components/brand.tsx';
import { Button, ErrorNote, Icon, Loading, StatusDot } from '../components/ui.tsx';
import { setSettingsScope } from '../settings-scope.ts';
import { useApp } from '../store.tsx';
import { asksAuto } from '@omni/shared/thread-run.ts';
import { runBody, type ChannelRun } from '@omni/shared/channel-form.ts';
import { applyRunToChannels, bulkRunError, NO_RUN, picksRun, resetChannelsToAuto, selectedIds, toggleSelected } from '@omni/shared/channel-bulk-run.ts';
import { RunDefaultsField } from './ChannelSettings.tsx';
import { Card, Origin, ResetButton, ServerOptions, useScopedChannel } from './settings-parts.tsx';

// Settings, Harnesses & models: each harness with whether it can run, how to fix it, its models and its cap; Hermes's
// server; the model a new thread starts on (a channel default, else Auto); and the .env options behind them. A thread or crew
// role that picks its own model wins over the channel (apps/server/harness/resolve.ts).

/** `hermes`: Hermes's config form, which Settings.tsx owns with the other config forms. */
export function ModelsSection({ hermes }: { hermes: ReactNode }) {
  const { channel } = useScopedChannel();
  return (
    <>
      <HarnessesCard channel={channel?.id} />
      {hermes}
      {channel ? <ChannelModelCard channel={channel} /> : <ChannelDefaultsCard />}
      <ServerOptions section="models" entry="model-options" />
    </>
  );
}

function HarnessesCard({ channel }: { channel?: string }) {
  const res = useApi<HarnessWithRunning[]>(harnessesPath(channel));
  return (
    <Card entry="harnesses" title="Harnesses" subtitle="The agents Omni can start a thread on. Omni checks each one again when a picker opens.">
      {res.error ? (
        <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>
      ) : !res.data ? (
        <Loading />
      ) : (
        <ul id="setting-concurrency" className="scroll-mt-6 divide-y divide-line">
          {res.data.map((h) => {
            const def = h.models.find((m) => m.default) ?? h.models[0];
            return (
              <li key={h.id} className="flex min-w-0 items-start gap-3 py-2.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg">
                  <HarnessLogo harness={h.id} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{h.name}</div>
                  <p className="mt-0.5 text-[12.5px] text-fg-3">
                    {h.plan} · {h.models.length} {h.models.length === 1 ? 'model' : 'models'}
                    {def && ` · default ${def.label}`} · {h.running} of {h.cap} running
                  </p>
                  {!h.available && (h.fix || h.install) && (
                    <p className="mt-1 text-[12.5px] text-fg-2">
                      {/* A command reads as code; a sentence of steps as text. */}
                      To fix: {isCommand(h.fix ?? h.install ?? '') ? <code className="text-[11.5px]">{h.fix ?? h.install}</code> : (h.fix ?? h.install)}
                    </p>
                  )}
                </div>
                <span className="mt-0.5 inline-flex w-[76px] shrink-0 items-center gap-1.5 text-[12.5px] whitespace-nowrap text-fg-2">
                  <StatusDot status={h.available ? 'done' : 'needs'} size={7} />
                  {h.available ? 'Ready' : 'Not ready'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const isCommand = (s: string) => s.length < 60 && !/[.,]\s/.test(s);

/** A channel's default as one line: Auto, or the harness and model with its effort. */
export function runDefaultLabel(c: Pick<Channel, 'default_harness' | 'default_model' | 'default_effort'>, harnesses: HarnessWithRunning[] | undefined) {
  const run = { harness: c.default_harness ?? '', model: c.default_model ?? '', effort: c.default_effort ?? '' };
  if (!(run.harness || run.model || run.effort) || asksAuto(run)) return 'Auto';
  const h = harnesses?.find((x) => x.id === (run.harness || 'claude-code'));
  const m = h?.models.find((x) => x.id === run.model);
  return [h?.name ?? run.harness, m?.label ?? (run.model || 'its default model'), run.effort].filter(Boolean).join(' · ');
}

const setsDefault = (c: Channel) => !!(c.default_harness || c.default_model || c.default_effort);

/** Every channel: what a new thread starts on in each, and which set their own (T3's "mixed"). Tick several to set them at once. */
function ChannelDefaultsCard() {
  const { channels, reloadChannels } = useApp();
  const harnesses = useApi<HarnessWithRunning[]>('/harnesses');
  const listed = channels.filter((c) => !c.archived);
  const own = listed.filter(setsDefault);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const ids = selectedIds(listed, selected);
  const title = (c: Channel) => (c.id === 'conductor' ? 'Conductor' : `#${c.name}`);
  return (
    <Card
      entry="channel-model"
      title="Default model for new threads"
      subtitle="Without one, Auto picks from the prompt. A thread or crew role that picks its own model wins."
      actions={<Origin of={own.length ? 'mixed' : 'default'} label={own.length ? `${own.length} of ${listed.length} channels set one` : 'Auto everywhere'} />}
    >
      <div className="flex min-h-7 items-center gap-1 text-[12.5px] text-fg-3">
        <span className="min-w-0 flex-1">{ids.length ? `${ids.length} of ${listed.length} selected` : 'Tick channels to set them at once.'}</span>
        <Button variant="ghost" size="sm" disabled={ids.length === listed.length} onClick={() => setSelected(new Set(listed.map((c) => c.id)))}>
          Select all
        </Button>
        <Button variant="ghost" size="sm" disabled={!ids.length} onClick={() => setSelected(new Set())}>
          Select none
        </Button>
      </div>
      {ids.length > 0 && (
        <BulkRunBar
          ids={ids}
          name={(id) => title(listed.find((c) => c.id === id)!)}
          onDone={async (failed) => {
            await reloadChannels();
            setSelected(new Set(failed));
          }}
        />
      )}
      <ul className="divide-y divide-line">
        {listed.map((c) => {
          const on = selected.has(c.id);
          return (
            <li key={c.id} className="flex min-w-0 items-center gap-3">
              <SelectBox on={on} label={`Select ${title(c)}`} onClick={() => setSelected((s) => toggleSelected(s, c.id))} />
              <button type="button" onClick={() => setSettingsScope(c.id)} className="group flex min-w-0 flex-1 items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1 truncate text-[13px] group-hover:underline group-hover:underline-offset-2">{title(c)}</span>
                <span className="min-w-0 truncate text-[12.5px] text-fg-2">{runDefaultLabel(c, harnesses.data)}</span>
                <span className="flex w-[104px] shrink-0 justify-end max-sm:hidden">
                  <Origin of={setsDefault(c) ? 'channel' : 'default'} label={setsDefault(c) ? 'Set on channel' : 'Built-in default'} />
                </span>
                <Icon name="chevronRight" size={14} className="shrink-0 text-fg-3" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[12.5px] text-fg-3">Pick a channel to change its default, here or in Showing above.</p>
    </Card>
  );
}

/** A row's tick box, the multi-select mark of a question card (components/thread/QuestionCard.tsx). */
function SelectBox({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} onClick={onClick} className="-m-1.5 grid shrink-0 place-items-center p-1.5 max-sm:-m-3 max-sm:p-3">
      <span aria-hidden="true" className={`grid h-[18px] w-[18px] place-items-center rounded-[5px] ${on ? 'bg-fg text-on-ink' : 'shadow-[inset_0_0_0_1.5px_var(--line-strong)]'}`}>
        {on && <Icon name="check" size={12} strokeWidth={2.6} />}
      </span>
    </button>
  );
}

/**
 * The picked channels' shared default: the single-channel picker (unavailable harnesses and models disabled, as there),
 * Apply to send it to all of them, and Reset to Auto to clear theirs. `onDone` gets the ids that did not save.
 */
function BulkRunBar({ ids, name, onDone }: { ids: string[]; name: (id: string) => string; onDone: (failed: string[]) => Promise<void> }) {
  const [run, setRun] = useState<ChannelRun>(NO_RUN);
  const [busy, setBusy] = useState<'apply' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (kind: 'apply' | 'reset') => {
    setBusy(kind);
    setError(null);
    const patch = (id: string, body: ReturnType<typeof runBody>) => api.patch(`/channels/${encodeURIComponent(id)}`, body);
    const r = kind === 'apply' ? await applyRunToChannels(ids, run, patch) : await resetChannelsToAuto(ids, patch);
    setError(bulkRunError(r, name));
    await onDone(r.failed.map((f) => f.id));
    if (!r.failed.length) setRun(NO_RUN);
    setBusy(null);
  };
  const n = `${ids.length} ${ids.length === 1 ? 'channel' : 'channels'}`;
  return (
    <div role="group" aria-label="Set the selected channels" className="space-y-2 rounded-[14px] bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <RunDefaultsField value={run} onChange={setRun} noReset />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" busy={busy === 'reset'} disabled={!!busy} onClick={() => void send('reset')}>
            Reset to Auto
          </Button>
          <Button type="button" variant="primary" busy={busy === 'apply'} disabled={!!busy || !picksRun(run)} onClick={() => void send('apply')}>
            Apply to {n}
          </Button>
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/** One channel in scope: its default, edited here and saved on pick. */
function ChannelModelCard({ channel }: { channel: Channel }) {
  const { reloadChannels } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = { harness: channel.default_harness ?? '', model: channel.default_model ?? '', effort: channel.default_effort ?? '' };
  const save = async (run: typeof value) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/channels/${encodeURIComponent(channel.id)}`, runBody(run));
      await reloadChannels();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const set = setsDefault(channel);
  return (
    <Card
      entry="channel-model"
      title="Default model for new threads"
      subtitle="What a new thread in this channel starts on. A thread or crew role that picks its own wins. Saved when you pick."
      actions={
        <>
          <Origin of={set ? 'channel' : 'default'} label={set ? `Set on #${channel.name}` : 'Built-in default: Auto'} />
          <ResetButton of={set ? 'channel' : 'default'} onReset={() => void save({ harness: '', model: '', effort: '' })} busy={busy} />
        </>
      }
    >
      <RunDefaultsField channel={channel.id} value={value} onChange={(v) => void save(v)} noReset />
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}
