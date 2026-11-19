import { useEffect, useRef, useState } from 'react';
import { term } from '@omni/shared/display.ts';
import { useTechnical } from '../display.ts';
import { api, errorText, useApi, type HarnessWithRunning, type SendMode, type Thread } from '../api.ts';
import { AttachmentStrip, useAttachments, useReplySend } from '../components/Composer.tsx';
import { useAutosize } from '../components/composer/controls.tsx';
import { ErrorNote, Icon, type IconName } from '../components/ui.tsx';
import { LivesOnNote, sendRefusal, type SendRefusal } from '../components/thread/LivesOn.tsx';
import type { Takeover } from '@omni/shared/handoff.ts';
import { ContextChips } from '../message-context/ContextChips.tsx';
import { removeDraftContext, useDraftContext } from '../message-context/draft.ts';
import { machineMentions } from '../message-context/machine-mention.tsx';
import { FileMenu, useFileMenu } from '../components/FileMenu.tsx';
import { canSteer } from '../steer.ts';
import { currentRun, pickedModelRun, shownRun, threadChoice, threadRunLabels } from '@omni/shared/thread-run.ts';
import type { Run } from '@omni/shared/run-switch.ts';
import { useDictation, withPhrase } from './dictation.ts';
import { PICK, PlusSheet, type Pick } from './PlusSheet.tsx';
import { ModelSheet } from './ModelSheet.tsx';
import { pickerAccounts, useAccounts } from '../accounts.ts';
import { MoDiff, MoRound } from './parts.tsx';

export interface ComposerChip {
  label: string;
  icon?: IconName;
  diff?: [number, number];
  onClick: () => void;
  disabled?: boolean;
}

/** Each thread's unsent text, kept while Ben moves between screens. */
const drafts = new Map<string, string>();

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
  stop,
  takeover,
  onTakeOver,
}: {
  thread: Thread;
  chips: ComposerChip[];
  /** The thread's Take over, for the card a send to a thread that lives on another machine can show. */
  takeover?: Takeover | null;
  /** Opens the Take over sheet. */
  onTakeOver?: () => void;
  /** Set while a turn runs that can be stopped: an empty box shows Stop where Send sits. */
  stop?: { busy: boolean; run: () => void } | null;
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
  // A send the server refused with where the thread lives or a raw reason (components/thread/LivesOn.tsx).
  const [away, setAway] = useState<SendRefusal | null>(null);
  const [plus, setPlus] = useState(false);
  const [runSheet, setRunSheet] = useState(false);
  // The thread shows as this machine's, as on the desktop reply box: its run sheet names this machine's accounts.
  const accounts = useAccounts();
  const [switching, setSwitching] = useState(false);
  const { data: harnesses, reload } = useApi<HarnessWithRunning[]>('/harnesses');
  const technical = useTechnical();
  const att = useAttachments();
  const context = useDraftContext(thread.id);
  const send = useReplySend(thread.id);
  const ref = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  // The `@` menu: files, and in a thread that can delegate, the machines a task can be sent to.
  const mentions = machineMentions(thread.id, setError);
  const update = (v: string) => {
    setText(v);
    drafts.set(thread.id, v);
    mentions.edited(v);
  };
  const mic = useDictation((p) => update(withPhrase(ref.current?.value ?? '', p)));
  const fileMenu = useFileMenu({ ref, text, onText: update, scope: `thread=${encodeURIComponent(thread.id)}`, onMachine: mentions.picked });
  const { aria: menuAria, ...menuEvents } = fileMenu.textarea;
  // Once Take over is asked for (or the thread is here again), the card's offer is past.
  useEffect(() => {
    if (!takeover) setAway((a) => (a?.livesOn ? null : a));
  }, [takeover]);

  useAutosize(ref, text);

  const busyThread = thread.status === 'running' || thread.status === 'queued';
  // A switch queued behind the turn: the message waits for it too (apps/server/runner/queue.ts), so it queues.
  const steers = canSteer(thread.harness, harnesses) && !thread.queued_harness;
  const hint = typeof placeholder === 'function' ? placeholder(steers) : placeholder;
  const canSend = !!text.trim() || context.length > 0;
  /** `sendThere`: the card's Send there, which lets the message wait for a machine that is asleep. */
  const submit = async (sendThere = false) => {
    const prompt = text.trim();
    if (!canSend || busy) return;
    const mode: SendMode | undefined = busyThread ? (steers ? 'steer' : 'queue') : undefined;
    setBusy(true);
    setError(null);
    setAway(null);
    // The box empties now: the message shows in the thread while it goes, and comes back here if it fails.
    const raw = text;
    const files = att.files;
    setText('');
    drafts.delete(thread.id);
    att.clear();
    try {
      const t = await send(prompt, mode, files, context, sendThere ? undefined : 'ask');
      onSent(t, mode);
    } catch (e) {
      // Unless Ben started a new message meanwhile.
      const now = ref.current?.value ?? '';
      if (!now || now === raw) update(raw);
      att.add(files);
      const refusal = sendRefusal(e);
      if (refusal.livesOn || refusal.detail) setAway(refusal);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = shownRun(thread);
  const next = shown !== thread ? threadRunLabels(shown, harnesses).model : null;
  const switchRun = async (choice: { harness: string; model: string }, effort: string) => {
    await post(pickedModelRun(shown, harnesses, choice, effort));
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
              className="mo-press inline-flex h-9 shrink-0 items-center gap-[7px] rounded-full px-3.5 text-[13.5px] leading-none text-fg-2 shadow-[inset_0_0_0_1px_var(--line-strong)] disabled:opacity-50"
            >
              {c.icon && <Icon name={c.icon} size={15} />}
              {c.label}
              {c.diff && <MoDiff add={c.diff[0]} del={c.diff[1]} />}
            </button>
          ))}
        </div>
      )}
      {away && (
        <LivesOnNote
          mobile
          className="mb-2"
          refusal={away}
          takeover={takeover}
          busy={busy}
          onSendThere={() => void submit(true)}
          onTakeOver={() => onTakeOver?.()}
        />
      )}
      {(att.error || error) && <ErrorNote className="mb-2">{att.error ?? error}</ErrorNote>}
      <div className="relative flex flex-col rounded-[26px] bg-surface">
        {fileMenu.menu && <FileMenu {...fileMenu.menu} />}
        <ContextChips records={context} onRemove={(id) => removeDraftContext(thread.id, id)} className="px-3 pt-3 pb-0.5" />
        <AttachmentStrip files={att.files} onRemove={att.remove} />
        <div className="flex min-h-[52px] items-end gap-1.5 p-1.5">
          <MoRound icon="plus" label={term('plusSheet', technical)} onClick={() => setPlus(true)} disabled={busy} />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            {...menuEvents}
            {...(fileMenu.open ? menuAria : {})}
            onChange={(e) => {
              update(e.target.value);
              menuEvents.onChange(e);
            }}
            onKeyDown={(e) => void fileMenu.onKey(e)}
            onPaste={att.onPaste}
            enterKeyHint="send"
            placeholder={hint}
            aria-label={hint}
            className="field-sizing-content max-h-[132px] min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-2 text-[16px] leading-[1.35] text-fg outline-none placeholder:text-fg-3"
          />
          {stop && !canSend && !att.files.length && !mic.on ? (
            <MoRound ink icon="stop" label={stop.busy ? 'Stopping' : 'Stop'} onClick={stop.run} disabled={stop.busy} />
          ) : canSend || !mic.supported ? (
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
          accounts={pickerAccounts(accounts.data, 'here')}
        />
      )}
    </div>
  );
}
