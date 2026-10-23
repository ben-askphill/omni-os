import { useLayoutEffect, useRef, useState } from 'react';
import { errorText, useApi, type HarnessWithRunning, type SendMode, type Thread } from '../api.ts';
import { HarnessLogo } from '../components/brand.tsx';
import { AttachmentStrip, useAttachments, useReplySend } from '../components/Composer.tsx';
import { modelOf } from '../components/ModelPicker.tsx';
import { ErrorNote, Icon, type IconName } from '../components/ui.tsx';
import { canSteer } from '../steer.ts';
import { useDictation, withPhrase } from './dictation.ts';
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
 * What the + opens: a photo, the camera or a file for the next message, and the thread's model and effort, which
 * are set when the thread starts and shown here only.
 */
function PlusSheet({ thread, harnesses, onPick, onClose }: { thread: Thread; harnesses?: HarnessWithRunning[]; onPick: (p: Pick) => void; onClose: () => void }) {
  const { harness, model } = harnesses ? modelOf(harnesses, { harness: thread.harness, model: thread.model ?? '' }) : { harness: undefined, model: undefined };
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
          <MoListRow
            icon={<HarnessLogo harness={thread.harness} size={15} />}
            label="Model"
            sub={harness?.name}
            right={model?.label ?? thread.model ?? 'Default'}
            chevron={false}
          />
          <MoListRow icon="gauge" label="Effort" right={thread.effort || model?.defaultEffort || 'Default'} chevron={false} last />
        </MoGroup>
        <p className="m-0 px-2 pt-2.5 text-[12.5px] leading-[1.45] text-fg-3">A thread keeps the model it started on. Start a new thread to use another.</p>
      </div>
    </MoSheet>
  );
}

/**
 * The thread's composer on a phone: action chips, one line that grows, + for files and mic or send. It sends the way
 * the desktop reply box does: a busy thread is steered, or queued where the harness cannot steer.
 */
export function MoComposer({ thread, chips, placeholder, onSent }: { thread: Thread; chips: ComposerChip[]; placeholder: string; onSent: (t: Thread, mode?: SendMode) => void }) {
  const [text, setText] = useState(() => drafts.get(thread.id) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plus, setPlus] = useState(false);
  const { data: harnesses } = useApi<HarnessWithRunning[]>('/harnesses');
  const att = useAttachments();
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
  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const mode: SendMode | undefined = busyThread ? (canSteer(thread.harness, harnesses) ? 'steer' : 'queue') : undefined;
    setBusy(true);
    setError(null);
    try {
      const t = await send(prompt, mode, att.files);
      if ((drafts.get(thread.id) ?? '') === text) {
        drafts.delete(thread.id);
        setText('');
      }
      att.clear();
      onSent(t, mode);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
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
      {chips.length > 0 && (
        <div className="mo-scroll flex gap-2 overflow-x-auto pt-0.5 pb-2.5">
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
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-2 text-[16px] leading-[1.35] text-fg outline-none placeholder:text-fg-4"
          />
          {text.trim() || !mic.supported ? (
            <MoRound ink icon="send" label={busyThread ? 'Send to the running turn' : 'Send'} onClick={() => void submit()} disabled={!text.trim() || busy} />
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
      {plus && <PlusSheet thread={thread} harnesses={harnesses} onPick={pick} onClose={() => setPlus(false)} />}
    </div>
  );
}
