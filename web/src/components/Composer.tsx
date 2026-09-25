import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api, errorText, MODELS, type Thread } from '../api.ts';
import { navigate, takeComposerFocus } from '../router.ts';
import { useApp } from '../store.tsx';
import { ErrorNote, Icon, Kbd, Picker, Spinner, type PickerOption } from './ui.tsx';

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

const shell = (shape: string) =>
  `${shape} p-1.5 transition-[background-color,box-shadow] duration-200 shadow-[inset_0_0_0_1px_var(--line)] focus-within:bg-bg focus-within:shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_5px_var(--wash)]`;

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
      const t = await api.post<Thread>('/threads', {
        channel,
        prompt,
        role: role || undefined,
        model: model || undefined,
      });
      drafts.delete(key);
      setText('');
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
    <div className={shell(big ? 'rounded-[30px] bg-surface' : 'rounded-[26px] bg-surface')}>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => update(e.target.value)}
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
      {error && <ErrorNote className="m-1 mt-2">{error}</ErrorNote>}
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
  useAutosize(ref, text, 240);

  useEffect(() => {
    setText(drafts.get(key) ?? '');
    setError(null);
  }, [key]);

  const busyThread = status === 'running' || status === 'queued';

  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.post<Thread>(`/threads/${encodeURIComponent(threadId)}/messages`, { prompt });
      drafts.delete(key);
      setText('');
      onSent?.(t);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={shell('rounded-[24px] bg-elev')}>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          drafts.set(key, e.target.value);
        }}
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
      {error && <ErrorNote className="m-1 mt-2">{error}</ErrorNote>}
    </div>
  );
}
