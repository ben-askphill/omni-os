import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type ReactNode, type RefObject } from 'react';
import { api, errorText, MODELS, type Thread } from '../api.ts';
import { bytes } from '../format.ts';
import { navigate, takeComposerFocus } from '../router.ts';
import { useApp } from '../store.tsx';
import { ErrorNote, Icon, IconButton, Kbd, Picker, Spinner, type PickerOption } from './ui.tsx';

// Unsent text survives navigation (not reloads). Keyed by where the composer lives.
const drafts = new Map<string, string>();

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, max: number) {
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, max]);
  useLayoutEffect(fit, [fit, value]);
  // The placeholder counts toward scrollHeight, so a measurement taken before layout or font load
  // settles can come out far too tall. Refit when the width or the fonts change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void document.fonts?.ready.then(fit);
    if (typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fit]);
}

function useFocusRequests(ref: RefObject<HTMLTextAreaElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (takeComposerFocus()) ref.current?.focus();
    const on = () => {
      takeComposerFocus();
      ref.current?.focus();
    };
    window.addEventListener('omni:focus-composer', on);
    return () => window.removeEventListener('omni:focus-composer', on);
  }, [ref, enabled]);
}

// ---------- attachments ----------

const MAX_ATTACHMENTS = 10;
const isImage = (f: File) => f.type.startsWith('image/');
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** Files staged for the next message: paperclip, drag-and-drop and paste all land here. */
function useAttachments() {
  const { status } = useApp();
  const maxMb = status?.maxUploadMb ?? 25;
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/leave also fire for children, so count them

  const add = useCallback(
    (incoming: File[]) => {
      if (!incoming.length) return;
      const tooBig = incoming.filter((f) => f.size > maxMb * 1024 * 1024);
      const ok = incoming.filter((f) => f.size <= maxMb * 1024 * 1024 && f.size > 0);
      setFiles((prev) => {
        const next = [...prev];
        for (const f of ok) if (!next.some((x) => sameFile(x, f))) next.push(f);
        if (next.length > MAX_ATTACHMENTS) {
          setError(`At most ${MAX_ATTACHMENTS} files per message.`);
          return next.slice(0, MAX_ATTACHMENTS);
        }
        return next;
      });
      setError(tooBig.length ? `${tooBig.map((f) => `"${f.name}"`).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over the ${maxMb} MB limit.` : null);
    },
    [maxMb],
  );

  const remove = (f: File) => setFiles((prev) => prev.filter((x) => x !== f));
  const clear = () => {
    setFiles([]);
    setError(null);
  };

  const onPaste = (e: ReactClipboardEvent) => {
    const pasted = [...(e.clipboardData?.files ?? [])];
    // Text pastes carry no files; only intercept when something real came along.
    if (!pasted.length) return;
    e.preventDefault();
    add(pasted);
  };

  const dropZone = {
    onDragEnter: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      if (--depth.current <= 0) {
        depth.current = 0;
        setOver(false);
      }
    },
    onDrop: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      add([...e.dataTransfer.files]);
    },
  };

  return { files, error, setError, add, remove, clear, over, onPaste, dropZone };
}

function Thumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover shadow-[inset_0_0_0_1px_var(--line)]" />;
}

/** Staged attachments, above the input, each removable until the message is sent. */
function AttachmentStrip({ files, onRemove }: { files: File[]; onRemove: (f: File) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-1.5 pt-1.5 pb-0.5">
      {files.map((f, i) => (
        <span key={`${f.name}:${f.size}:${i}`} className="flex h-11 max-w-[15rem] items-center gap-2 rounded-2xl bg-surface-2 pr-1 pl-1 text-[12.5px]">
          {isImage(f) ? (
            <Thumb file={f} />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg text-fg-3">
              <Icon name="file" size={15} />
            </span>
          )}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-medium text-fg-2">{f.name}</span>
            <span className="block font-num text-[10.5px] text-fg-4">{bytes(f.size)}</span>
          </span>
          <IconButton icon="x" label={`Remove ${f.name}`} size={13} className="h-6 w-6" onClick={() => onRemove(f)} />
        </span>
      ))}
    </div>
  );
}

function AttachButton({ onPick, disabled }: { onPick: (files: File[]) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onPick([...(e.target.files ?? [])]);
          e.target.value = ''; // so picking the same file twice still fires
        }}
      />
      <IconButton icon="paperclip" label="Attach files" size={15} disabled={disabled} onClick={() => ref.current?.click()} />
    </>
  );
}

const KIND: Record<string, string> = { client: 'Client', internal: 'Internal', personal: 'Personal', system: 'System' };

/** Bencho "cmd" go button: quiet until there is something to send, then ink. */
function SendButton({ armed, busy, onClick, children }: { armed: boolean; busy: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!armed || busy}
      data-armed={armed || undefined}
      className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-surface-3 pr-4 pl-3.5 text-[13px] font-medium text-fg-4 transition-[background-color,color,transform] duration-300 data-[armed]:bg-fg data-[armed]:text-on-ink"
    >
      {busy ? <Spinner size={14} /> : <Icon name="send" size={15} strokeWidth={2} />}
      {children}
    </button>
  );
}

function Hint() {
  return (
    <span className="hidden items-center gap-1 text-[11.5px] text-fg-4 sm:inline-flex">
      <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
      <Kbd>↵</Kbd>
    </span>
  );
}

const shell = (shape: string, over = false) =>
  `${shape} relative p-1.5 transition-[background-color,box-shadow] duration-200 focus-within:bg-bg ${
    over
      ? 'shadow-[inset_0_0_0_1.5px_var(--line-strong),0_0_0_5px_var(--wash)]'
      : 'shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_5px_var(--wash)]'
  }`;

function DropHint({ over }: { over: boolean }) {
  if (!over) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-bg/85">
      <span className="flex items-center gap-2 text-[13px] font-medium text-fg-2">
        <Icon name="paperclip" size={15} /> Drop to attach
      </span>
    </div>
  );
}

/** Starts a new thread. `channelId` fixes the channel (channel page); otherwise a picker is shown. */
export function NewThreadComposer({
  channelId,
  defaultChannel = 'conductor',
  big,
  placeholder,
}: {
  channelId?: string;
  defaultChannel?: string;
  big?: boolean;
  placeholder?: string;
}) {
  const { channels, crew } = useApp();
  const key = `new:${channelId ?? '*'}`;
  const [text, setText] = useState(() => drafts.get(key) ?? '');
  const [channel, setChannel] = useState(channelId ?? defaultChannel);
  const [role, setRole] = useState<string>(() => ((channelId ?? defaultChannel) === 'conductor' ? 'conductor' : ''));
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const att = useAttachments();
  useAutosize(ref, text, big ? 360 : 260);
  useFocusRequests(ref, true);

  useEffect(() => {
    if (channelId) setChannel(channelId);
  }, [channelId]);

  // Default the role once crew loads, if the conductor channel is selected.
  useEffect(() => {
    if (!role && channel === 'conductor' && crew.some((r) => r.id === 'conductor')) setRole('conductor');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew]);

  const roleObj = crew.find((r) => r.id === role);
  const visibleChannels = channels.filter((c) => !c.archived);

  const onRole = (r: string) => {
    setRole(r);
    const rc = crew.find((x) => x.id === r)?.channel;
    if (!channelId && rc && channels.some((c) => c.id === rc)) setChannel(rc);
  };
  const onChannel = (c: string) => {
    setChannel(c);
    if (c === 'conductor' && !role && crew.some((r) => r.id === 'conductor')) setRole('conductor');
    if (c !== 'conductor' && role === 'conductor') setRole('');
  };

  const update = (v: string) => {
    setText(v);
    drafts.set(key, v);
  };

  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.send<Thread>(
        '/threads',
        { channel, prompt, role: role || undefined, model: model || undefined },
        att.files,
      );
      drafts.delete(key);
      setText('');
      att.clear();
      navigate(`/t/${t.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const channelOptions: PickerOption<string>[] = visibleChannels.map((c) => ({
    value: c.id,
    label: c.id === 'conductor' ? 'Conductor' : c.name,
    sub: KIND[c.kind] ?? c.kind,
    avatar: c.name,
    icon: c.id === 'conductor' ? 'target' : undefined,
  }));
  if (!visibleChannels.some((c) => c.id === channel)) channelOptions.push({ value: channel, label: channel, avatar: channel });
  const roleOptions: PickerOption<string>[] = [
    { value: '', label: 'No role', sub: 'Plain Claude, no charter', avatar: false, icon: 'x' },
    ...crew.map((r) => ({ value: r.id, label: r.name, sub: r.description, avatar: r.name })),
  ];
  const modelOptions: PickerOption<string>[] = [
    { value: '', label: roleObj?.model ? `Default (${roleObj.model})` : 'Default model', sub: roleObj?.model ? `Set by ${roleObj.name}` : undefined, avatar: false, icon: 'sliders' },
    ...MODELS.map((m) => ({ value: m, label: m, avatar: false as const, icon: 'zap' as const })),
  ];

  return (
    <div className={shell(big ? 'rounded-[30px] bg-surface' : 'rounded-[26px] bg-surface', att.over)} {...att.dropZone}>
      <DropHint over={att.over} />
      <AttachmentStrip files={att.files} onRemove={att.remove} />
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => update(e.target.value)}
        onPaste={att.onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={big ? 3 : 2}
        placeholder={placeholder ?? (channel === 'conductor' ? 'Ask the Conductor anything. It delegates to the crew.' : 'Describe the task')}
        className={`block w-full resize-none bg-transparent px-4 pt-3 pb-1 tracking-[-0.01em] outline-none placeholder:text-fg-4 ${big ? 'min-h-[96px] text-[16px]' : 'min-h-[60px] text-[14.5px]'}`}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1">
        <AttachButton onPick={att.add} disabled={busy} />
        {!channelId && <Picker label="Channel" value={channel} options={channelOptions} onChange={onChannel} />}
        <Picker label="Role" value={role} options={roleOptions} onChange={onRole} />
        <Picker label="Model" value={model} options={modelOptions} onChange={setModel} />
        <div className="ml-auto flex items-center gap-2.5">
          <Hint />
          <SendButton armed={!!text.trim()} busy={busy} onClick={submit}>
            Start
          </SendButton>
        </div>
      </div>
      {roleObj?.description && <div className="px-4 pt-2.5 pb-1.5 text-[12px] text-fg-3">{roleObj.description}</div>}
      {(att.error || error) && <ErrorNote className="m-1 mt-2">{att.error ?? error}</ErrorNote>}
    </div>
  );
}

/** Follow-up composer pinned under a thread. */
export function ReplyComposer({
  threadId,
  status,
  onSent,
  extra,
}: {
  threadId: string;
  status: string;
  onSent?: (t: Thread) => void;
  extra?: ReactNode;
}) {
  const key = `reply:${threadId}`;
  const [text, setText] = useState(() => drafts.get(key) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const att = useAttachments();
  useAutosize(ref, text, 240);

  useEffect(() => {
    setText(drafts.get(key) ?? '');
    setError(null);
    att.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const busyThread = status === 'running' || status === 'queued';

  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.send<Thread>(`/threads/${encodeURIComponent(threadId)}/messages`, { prompt }, att.files);
      drafts.delete(key);
      setText('');
      att.clear();
      onSent?.(t);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={shell('rounded-[24px] bg-elev', att.over)} {...att.dropZone}>
      <DropHint over={att.over} />
      <AttachmentStrip files={att.files} onRemove={att.remove} />
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          drafts.set(key, e.target.value);
        }}
        onPaste={att.onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={1}
        placeholder={busyThread ? 'Queue a follow-up. It runs when the current turn ends.' : 'Reply'}
        className="block min-h-[44px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14.5px] tracking-[-0.01em] outline-none placeholder:text-fg-4"
      />
      <div className="flex items-center gap-2 px-1">
        <AttachButton onPick={att.add} disabled={busy} />
        {extra}
        <div className="ml-auto flex items-center gap-2.5">
          {busyThread && (
            <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
              <Icon name="clock" size={12} /> {status === 'queued' ? 'Queued' : 'Will queue'}
            </span>
          )}
          <Hint />
          <SendButton armed={!!text.trim()} busy={busy} onClick={submit}>
            {busyThread ? 'Queue' : 'Send'}
          </SendButton>
        </div>
      </div>
      {(att.error || error) && <ErrorNote className="m-1 mt-2">{att.error ?? error}</ErrorNote>}
    </div>
  );
}
