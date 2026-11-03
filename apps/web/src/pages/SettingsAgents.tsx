import { useState } from 'react';
import { api, errorText, harnessesPath, useApi, type Channel, type HarnessWithRunning } from '../api.ts';
import { HarnessLogo } from '../components/brand.tsx';
import { ErrorNote, Loading, StatusDot } from '../components/ui.tsx';
import { setSettingsScope } from '../settings-scope.ts';
import { useApp } from '../store.tsx';
import { asksAuto } from '@omni/shared/thread-run.ts';
import { RunDefaultsField } from './ChannelSettings.tsx';
import { Card, Origin, ServerOptions, useScopedChannel } from './settings-parts.tsx';

// Settings, Harnesses & models: each harness with whether it can run, how to fix it, its models and its cap; the
// model a new thread starts on (a channel default, else Auto); and the .env options behind them. A thread or crew
// role that picks its own model wins over the channel (apps/server/harness/resolve.ts).

export function ModelsSection() {
  const { channel } = useScopedChannel();
  return (
    <>
      <HarnessesCard channel={channel?.id} />
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
                  <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                    {h.name}
                    <span className="inline-flex items-center gap-1 text-[12px] font-normal text-fg-3">
                      <StatusDot status={h.available ? 'done' : 'needs'} size={7} />
                      {h.available ? 'Ready' : 'Not ready'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-fg-3">
                    {h.plan} · {h.models.length} {h.models.length === 1 ? 'model' : 'models'}
                    {def && ` · default ${def.label}`} · {h.running} of {h.cap} running
                  </p>
                  {!h.available && (h.fix || h.install) && (
                    <p className="mt-1 text-[12px] text-fg-2">
                      {/* A command reads as code; a sentence of steps as text. */}
                      To fix: {isCommand(h.fix ?? h.install ?? '') ? <code className="text-[11.5px]">{h.fix ?? h.install}</code> : (h.fix ?? h.install)}
                    </p>
                  )}
                </div>
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

/** Every channel: what a new thread starts on in each, and which set their own (T3's "mixed"). */
function ChannelDefaultsCard() {
  const { channels } = useApp();
  const harnesses = useApi<HarnessWithRunning[]>('/harnesses');
  const listed = channels.filter((c) => !c.archived);
  const own = listed.filter(setsDefault);
  return (
    <Card
      entry="channel-model"
      title="Default model for new threads"
      subtitle="Each channel can name the model its new threads start on. Without one, Auto picks from the prompt. A thread or crew role that picks its own wins."
      origin={<Origin of={own.length ? 'mixed' : 'default'} label={own.length ? `${own.length} of ${listed.length} channels set one` : 'Auto everywhere'} />}
    >
      <ul className="divide-y divide-line">
        {listed.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setSettingsScope(c.id)} className="flex w-full min-w-0 items-center gap-3 py-2 text-left hover:text-fg">
              <span className="min-w-0 flex-1 truncate text-[13px]">{c.id === 'conductor' ? 'Conductor' : `#${c.name}`}</span>
              <span className="min-w-0 truncate text-[12.5px] text-fg-2">{runDefaultLabel(c, harnesses.data)}</span>
              <Origin of={setsDefault(c) ? 'channel' : 'default'} label={setsDefault(c) ? 'Set on channel' : 'Built-in default'} />
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-fg-3">Pick a channel to change its default here, or in the scope above.</p>
    </Card>
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
      await api.patch(`/channels/${encodeURIComponent(channel.id)}`, {
        default_harness: run.harness || null,
        default_model: run.model || null,
        default_effort: run.effort || null,
      });
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
      origin={<Origin of={set ? 'channel' : 'default'} label={set ? `Set on #${channel.name}` : 'Built-in default: Auto'} onReset={() => void save({ harness: '', model: '', effort: '' })} busy={busy} />}
    >
      <RunDefaultsField channel={channel.id} value={value} onChange={(v) => void save(v)} noReset />
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}
