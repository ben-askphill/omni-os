import { useEffect, useRef, useState } from 'react';
import { api, errorText, harnessesPath, useApi, type HarnessWithRunning, type Thread } from '../api.ts';
import { HarnessLogo, OmniMark } from '../components/brand.tsx';
import { useBasePick, useBaseRows } from '../components/BasePicker.tsx';
import { AttachmentStrip, useAttachments } from '../components/Composer.tsx';
import type { ModelChoice } from '../components/ModelPicker.tsx';
import { Avatar, ErrorNote } from '../components/ui.tsx';
import { draftRun, draftRunRequest } from '../new-thread-preset.ts';
import { baseRequest } from '../worktree-base.ts';
import { asksAuto } from '../thread-run.ts';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';
import { useDictation, withPhrase } from './dictation.ts';
import { BaseChip, BaseSheet } from './BaseSheet.tsx';
import { ModelSheet, runLabel } from './ModelSheet.tsx';
import { MoRound, MoSheet } from './parts.tsx';
import { useShell } from './shell.tsx';

const pill = (on: boolean) =>
  `mo-press inline-flex h-9 shrink-0 items-center gap-[7px] rounded-full pr-3 pl-1.5 text-[13.5px] leading-none font-medium ${on ? 'bg-fg text-on-ink' : 'bg-surface-2 text-fg'}`;

/**
 * A new delegation to the Conductor, or a new thread in one channel: the same POST /threads the desktop composer
 * makes, with the role's or the channel's run defaults until Ben picks another model.
 */
export function NewSheet({ channel: initial }: { channel?: string }) {
  const shell = useShell();
  const { channels, crew } = useApp();
  const listed = channels.filter((c) => !c.archived && c.id !== 'conductor');
  const [target, setTarget] = useState(initial ?? 'conductor');
  const [text, setText] = useState('');
  // As the target channel sees them: Cursor Cloud needs its GitHub repo.
  const { data: harnesses, reload } = useApi<HarnessWithRunning[]>(harnessesPath(target));
  // A pick holds for the target it was made for; another target starts on its own defaults, as on the desktop.
  const [picked, setPicked] = useState<{ target: string; choice: ModelChoice; effort: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickingBase, setPickingBase] = useState(false);
  const [base, setBase] = useBasePick(target);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const att = useAttachments();
  const file = useRef<HTMLInputElement>(null);
  const mic = useDictation((p) => setText((t) => withPhrase(t, p)));
  const strip = useRef<HTMLDivElement>(null);
  // A block body: scrollIntoView returns a promise in newer Chrome, which React would take for a cleanup.
  useEffect(() => {
    strip.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, []);

  const conductor = target === 'conductor';
  const ch = conductor ? undefined : listed.find((c) => c.id === target);
  const role = conductor && crew.some((r) => r.id === 'conductor') ? 'conductor' : '';
  const ro = crew.find((r) => r.id === role);
  const run = harnesses ? draftRun(picked?.target === target ? picked : null, ro, channels.find((c) => c.id === target), harnesses) : null;
  const { rows: baseRows, reload: reloadBases } = useBaseRows(target, run?.choice.harness ?? '');
  const onTarget = (next: string) => {
    if (next === target) return;
    setTarget(next);
    setPicked(null);
  };
  const close = () => shell.sheet(null);

  const send = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.send<Thread>(
        '/threads',
        {
          channel: target,
          prompt,
          role: role || undefined,
          ...draftRunRequest(picked?.target === target ? run : null),
          ...baseRequest(base, run?.choice.harness),
        },
        att.files,
      );
      shell.open(href.thread(t.id));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <>
      <MoSheet onClose={close} label={conductor ? 'New delegation' : 'New thread'}>
        <div className="flex shrink-0 items-center px-3 pt-1.5 pb-2">
          <button type="button" onClick={close} className="w-[60px] px-1.5 py-2 text-left text-[15px]">
            Cancel
          </button>
          <span className="flex-1 text-center text-[15px] font-medium">{conductor ? 'New delegation' : 'New thread'}</span>
          <span className="w-[60px]" />
        </div>
        <div ref={strip} className="mo-scroll flex shrink-0 gap-2 overflow-x-auto px-4 pb-3">
          <button type="button" onClick={() => onTarget('conductor')} className={pill(conductor)} aria-pressed={conductor}>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-bg text-fg">
              <OmniMark size={18} />
            </span>
            Conductor
          </button>
          {listed.map((c) => (
            <button key={c.id} type="button" onClick={() => onTarget(c.id)} className={pill(target === c.id)} aria-pressed={target === c.id}>
              <Avatar name={c.name} channelIcon={c.icon} size={24} />#{c.name}
            </button>
          ))}
        </div>
        <div className="mx-3 flex flex-col gap-2.5 rounded-[26px] bg-surface px-2 pt-3.5 pb-2">
          <AttachmentStrip files={att.files} onRemove={att.remove} />
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={att.onPaste}
            rows={4}
            enterKeyHint="send"
            placeholder={ch ? `Describe the task for #${ch.name}` : 'Ask the Conductor. It delegates to the crew.'}
            className="resize-none bg-transparent px-2 text-[16px] leading-[1.45] text-fg outline-none placeholder:text-fg-4"
          />
          {baseRows && (
            <BaseChip
              rows={baseRows}
              value={base}
              onClick={() => {
                reloadBases();
                setPickingBase(true);
              }}
            />
          )}
          <div className="flex items-center gap-1.5">
            <input
              ref={file}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                att.add([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <MoRound icon="plus" label="Attach files" onClick={() => file.current?.click()} disabled={busy} />
            <button
              type="button"
              onClick={() => {
                void reload();
                setPicking(true);
              }}
              disabled={!harnesses}
              className="mo-press inline-flex h-10 min-w-0 items-center gap-[7px] rounded-full bg-surface-2 px-3 text-[13px] font-medium text-fg disabled:opacity-40"
            >
              {run && (asksAuto(run.choice) ? <OmniMark size={15} /> : <HarnessLogo harness={run.choice.harness} size={13} />)}
              <span className="truncate">{run ? runLabel(harnesses, run.choice, run.effort) : 'Model'}</span>
            </button>
            <span className="flex-1" />
            {text.trim() || !mic.supported ? (
              <MoRound ink icon="send" label="Send" onClick={() => void send()} disabled={!text.trim() || busy} />
            ) : (
              <MoRound ink={!mic.on} icon={mic.on ? 'stop' : 'mic'} label={mic.on ? 'Stop dictating' : 'Dictate'} onClick={mic.toggle} />
            )}
          </div>
        </div>
        {(att.error || error) && <ErrorNote className="mx-3 mt-2">{att.error ?? error}</ErrorNote>}
        <p className="m-0 px-6 pt-2.5 text-[12.5px] leading-[1.45] text-fg-3">
          {ch
            ? `Runs in #${ch.name} with its repo, store and browser profile.`
            : 'The Conductor picks the crew and reports back here. Activity shows you when something needs you.'}
        </p>
      </MoSheet>
      {pickingBase && baseRows && <BaseSheet rows={baseRows} value={base} onChange={setBase} onClose={() => setPickingBase(false)} />}
      {picking && harnesses && run && (
        <ModelSheet
          harnesses={harnesses}
          choice={run.choice}
          effort={run.effort}
          onChange={(choice, effort) => setPicked({ target, choice, effort })}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
