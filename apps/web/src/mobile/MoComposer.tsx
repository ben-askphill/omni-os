import { useLayoutEffect, useRef, useState } from 'react';
import { api, errorText, useApi, type HarnessWithRunning, type SendMode, type Thread } from '../api.ts';
import { HarnessLogo } from '../components/brand.tsx';
import { AttachmentStrip, useAttachments, useReplySend } from '../components/Composer.tsx';
import { sourceRefusal } from '../continue.ts';
import { ErrorNote, Icon, type IconName } from '../components/ui.tsx';
import { ContextChips } from '../message-context/ContextChips.tsx';
import { removeDraftContext, useDraftContext } from '../message-context/draft.ts';
import { canSteer } from '../steer.ts';
import { currentRun, pickedRun, shownRun, threadChoice, threadRunLabels } from '../thread-run.ts';
import type { Run } from '@omni/shared/run-switch.ts';
import { useDictation, withPhrase } from './dictation.ts';
import { ModelSheet } from './ModelSheet.tsx';
import { MoDiff, MoGroup, MoListRow, MoRound, MoSheet } from './parts.tsx';

export interface ComposerChip {
  label: string;
  icon?: IconName;
  diff?: [number, number];
  onClick: () => void;
  disabled?: boolean;
}

/** Each thread's unsent text, kept while Ben moves between screens. */
const drafts = new Map<string, string>();

const PICK = { photo: 'image/*', camera: 'image/*', file: undefined } as const;
type Pick = keyof typeof PICK;

/**
 * What the + opens: a photo, the camera or a file for the next message, and the thread's model and effort. Tapping
 * those opens the model sheet, which switches the run for the next turn, or once this one ends while it runs. A switch
 * queued that way shows here, with a row that drops it.
 */
function PlusSheet({
  thread,
  harnesses,
  onPick,
  onFork,
  onRun,
  onKeep,
  onClose,
}: {
  thread: Thread;
  harnesses?: HarnessWithRunning[];
  onPick: (p: Pick) => void;
  onFork: () => void;
  onRun?: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  const shown = shownRun(thread);
  const queued = shown !== thread;
  const labels = threadRunLabels(shown, harnesses);
  const now = threadRunLabels(thread, harnesses);
  const busy = thread.status === 'running' || thread.status === 'queued';
  const tiles: [Pick, IconName, string][] = [
    ['photo', 'image', 'Photo'],
    ['camera', 'maximize', 'Camera'],
    ['file', 'file', 'File'],
  ];
  return (
    <MoSheet onClose={onClose} label="Attach">
      <div className="grid grid-cols-3 gap-2 px-3 pt-3 pb-2.5">
        {tiles.map(([p, icon, label]) => (
          <button key={p} type="button" onClick={() => onPick(p)} className="mo-press flex h-[76px] flex-col items-center justify-center gap-2 rounded-[18px] bg-surface text-[13px]">
            <Icon name={icon} size={20} />
            {label}
          </button>
        ))}
      </div>
      <div className="px-3">
        <MoGroup>
          <MoListRow icon="branch" label="Fork thread" sub={sourceRefusal(thread.harness) ?? 'A new thread, on any harness, that picks up from here'} disabled={!!sourceRefusal(thread.harness)} onClick={onFork} />
        </MoGroup>
      </div>
      <div className="px-3 pt-2.5">
        <MoGroup>
          <MoListRow
            icon={<HarnessLogo harness={shown.harness} size={15} />}
            label={queued ? <span className="text-live-text">Next turn</span> : 'Model'}
            sub={labels.harnessName || undefined}
            right={labels.model}
            onClick={onRun}
          />
          <MoListRow icon="gauge" label="Effort" right={labels.effort} onClick={onRun} last={!queued} />
          {queued && <MoListRow icon="x" label={`Keep ${now.model}`} sub={`${now.harnessName ? `${now.harnessName}, ` : ''}${now.effort}`} onClick={onKeep} chevron={false} last />}
        </MoGroup>
        <p className="m-0 px-2 pt-2.5 text-[12.5px] leading-[1.45] text-fg-3">
          {queued
            ? `${labels.model} takes over when this turn ends. What you send now waits for it.`
            : busy
              ? 'A new model or effort takes over when this turn ends.'
              : 'A new model or effort takes over from the next message.'}
        </p>
      </div>
    </MoSheet>
  );
}

/**
 * The thread's composer on a phone: action chips, one line that grows, + for files and mic or send. It sends the way
 * the desktop reply box does: a busy thread is steered, or queued where the harness cannot steer.
 */
export function MoComposer({
  thread,
  chips,
  placeholder,
  onSent,
  onSwitched,
  onFork,
}: {
  thread: Thread;
  chips: ComposerChip[];
  /** A function gets whether a busy thread steers, so it can say queue where the harness cannot steer. */
  placeholder: string | ((steers: boolean) => string);
  onSent: (t: Thread, mode?: SendMode) => void;
  /** The thread after its run switched. */
  onSwitched: (t: Thread) => void;
  /** Opens the sheet that forks the thread. */
  onFork: () => void;
}) {
  const [text, setText] = useState(() => drafts.get(thread.id) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plus, setPlus] = useState(false);
  const [runSheet, setRunSheet] = useState(false);
  const [switching, setSwitching] = useState(false);
  const { data: harnesses, reload } = useApi<HarnessWithRunning[]>('/harnesses');
  const att = useAttachments();
  const context = useDraftContext(thread.id);
  const send = useReplySend(thread.id);
  const ref = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const update = (v: string) => {
    setText(v);
    drafts.set(thread.id, v);
  };
  const mic = useDictation((p) => update(withPhrase(ref.current?.value ?? '', p)));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const busyThread = thread.status === 'running' || thread.status === 'queued';
  // A switch queued behind the turn: the message waits for it too (apps/server/runner/queue.ts), so it queues.
  const steers = canSteer(thread.harness, harnesses) && !thread.queued_harness;
  const hint = typeof placeholder === 'function' ? placeholder(steers) : placeholder;
  const canSend = !!text.trim() || context.length > 0;
  const submit = async () => {
    const prompt = text.trim();
    if (!canSend || busy) return;
    const mode: SendMode | undefined = busyThread ? (steers ? 'steer' : 'queue') : undefined;
    setBusy(true);
    setError(null);
    // The box empties now: the message shows in the thread while it goes, and comes back here if it fails.
    const raw = text;
    const files = att.files;
    setText('');
    drafts.delete(thread.id);
    att.clear();
    try {
      const t = await send(prompt, mode, files, context);
      onSent(t, mode);
    } catch (e) {
      // Unless Ben started a new message meanwhile.
      const now = ref.current?.value ?? '';
      if (!now || now === raw) update(raw);
      att.add(files);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = shownRun(thread);
  const next = shown !== thread ? threadRunLabels(shown, harnesses).model : null;
  const switchRun = async (choice: { harness: string; model: string }, effort: string) => {
    const now = threadChoice(shown, harnesses);
    await post(pickedRun(shown, harnesses, choice.harness === now.harness && choice.model === now.model ? { effort } : choice));
  };
  const post = async (run: Run | null) => {
    if (!run || switching) return;
    setSwitching(true);
    setError(null);
    try {
      onSwitched(await api.post<Thread>(`/threads/${encodeURIComponent(thread.id)}/run`, run));
    } catch (e) {
      setError(errorText(e));
      // The error shows above the composer, which the sheet covers.
      setRunSheet(false);
    } finally {
      setSwitching(false);
    }
  };

  const pick = (p: Pick) => {
    setPlus(false);
    const el = file.current;
    if (!el) return;
    el.accept = PICK[p] ?? '';
    if (p === 'camera') el.setAttribute('capture', 'environment');
    else el.removeAttribute('capture');
    el.click();
  };

  return (
    // Not positioned, so the + sheet covers the screen rather than the composer.
    <div className="shrink-0 bg-bg px-3 pt-1.5" style={{ paddingBottom: 'max(12px, calc(env(safe-area-inset-bottom) - 2px))' }}>
      {(chips.length > 0 || next) && (
        <div className="mo-scroll flex gap-2 overflow-x-auto pt-0.5 pb-2.5">
          {next && (
            <button
              type="button"
              onClick={() => setPlus(true)}
              aria-label={`Next turn runs on ${next}`}
              className="mo-press inline-flex h-9 shrink-0 items-center gap-[7px] rounded-full bg-surface-2 px-3.5 text-[13.5px] leading-none font-medium text-fg ring-1 ring-live ring-inset"
            >
              <Icon name="clock" size={15} className="text-live-text" />
              <span className="text-live-text">Next turn</span>
              {next}
            </button>
          )}
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={c.onClick}
              disabled={c.disabled}
              className="mo-press inline-flex h-9 shrink-0 items-center gap-[7px] rounded-full bg-surface-2 px-3.5 text-[13.5px] leading-none font-medium text-fg disabled:opacity-50"
            >
              {c.icon && <Icon name={c.icon} size={15} />}
              {c.label}
              {c.diff && <MoDiff add={c.diff[0]} del={c.diff[1]} />}
            </button>
          ))}
        </div>
      )}
      {(att.error || error) && <ErrorNote className="mb-2">{att.error ?? error}</ErrorNote>}
      <div className="flex flex-col rounded-[26px] bg-surface">
        <ContextChips records={context} onRemove={(id) => removeDraftContext(thread.id, id)} className="px-3 pt-3 pb-0.5" />
        <AttachmentStrip files={att.files} onRemove={att.remove} />
        <div className="flex min-h-[52px] items-end gap-1.5 p-1.5">
          <MoRound icon="plus" label="Attach, model and effort" onClick={() => setPlus(true)} disabled={busy} />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => update(e.target.value)}
            onPaste={att.onPaste}
            enterKeyHint="send"
            placeholder={hint}
            aria-label={hint}
            className="min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-2 text-[16px] leading-[1.35] text-fg outline-none placeholder:text-fg-4"
          />
          {canSend || !mic.supported ? (
            <MoRound ink icon="send" label={!busyThread ? 'Send' : next ? 'Send after this turn' : 'Send to the running turn'} onClick={() => void submit()} disabled={!canSend || busy} />
          ) : (
            <MoRound quiet={!mic.on} ink={mic.on} icon={mic.on ? 'stop' : 'mic'} label={mic.on ? 'Stop dictating' : 'Dictate'} onClick={mic.toggle} />
          )}
        </div>
      </div>
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
      {plus && (
        <PlusSheet
          thread={thread}
          harnesses={harnesses}
          onPick={pick}
          onFork={() => {
            setPlus(false);
            onFork();
          }}
          onRun={
            harnesses
              ? () => {
                  setPlus(false);
                  reload();
                  setRunSheet(true);
                }
              : undefined
          }
          onKeep={() => {
            setPlus(false);
            void post(currentRun(thread));
          }}
          onClose={() => setPlus(false)}
        />
      )}
      {runSheet && harnesses && (
        <ModelSheet
          harnesses={harnesses}
          choice={threadChoice(shown, harnesses)}
          effort={shown.effort}
          onChange={(c, e) => void switchRun(c, e)}
          onClose={() => setRunSheet(false)}
        />
      )}
    </div>
  );
}
