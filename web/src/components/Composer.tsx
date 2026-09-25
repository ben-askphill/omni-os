import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api, errorText, MODELS, type Thread } from '../api.ts';
import { navigate, takeComposerFocus } from '../router.ts';
import { useApp } from '../store.tsx';
import { Button, ErrorNote, Icon, Kbd } from './ui.tsx';

// Unsent text survives navigation (not reloads). Keyed by where the composer lives.
const drafts = new Map<string, string>();

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, max: number) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, value, max]);
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

const selectCls =
  'h-7 max-w-[11rem] appearance-none truncate rounded-md border border-line bg-surface-2 pr-6 pl-2 text-[12.5px] text-fg-2 outline-none hover:border-line-strong focus:border-fg-3';
const selectStyle = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 7px center',
};

function Picker({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-1">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={selectCls} style={selectStyle}>
        {children}
      </select>
    </label>
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

  return (
    <div className="rounded-xl border border-line-strong bg-surface shadow-[var(--shadow-card)] transition-colors focus-within:border-fg-4">
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
        className={`block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 outline-none placeholder:text-fg-4 ${big ? 'min-h-[84px] text-[15px]' : 'min-h-[56px] text-[14px]'}`}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-1 pb-2.5">
        {!channelId && (
          <Picker label="Channel" value={channel} onChange={onChannel}>
            {visibleChannels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.id}
              </option>
            ))}
            {!visibleChannels.some((c) => c.id === channel) && <option value={channel}>#{channel}</option>}
          </Picker>
        )}
        <Picker label="Role" value={role} onChange={onRole}>
          <option value="">No role</option>
          {crew.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Picker>
        <Picker label="Model" value={model} onChange={setModel}>
          <option value="">{roleObj?.model ? `Default (${roleObj.model})` : 'Default model'}</option>
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Picker>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11.5px] text-fg-4 sm:inline">
            <Kbd>{isMac ? 'Cmd' : 'Ctrl'}</Kbd> <Kbd>Enter</Kbd>
          </span>
          <Button variant="primary" size="sm" onClick={submit} busy={busy} disabled={!text.trim()} icon="send">
            Start
          </Button>
        </div>
      </div>
      {roleObj?.description && <div className="border-t border-line px-3.5 py-1.5 text-[12px] text-fg-3">{roleObj.description}</div>}
      {error && <ErrorNote className="m-2 mt-0">{error}</ErrorNote>}
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
    <div className="rounded-xl border border-line-strong bg-surface shadow-[var(--shadow-card)] focus-within:border-fg-4">
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
        className="block min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] outline-none placeholder:text-fg-4"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2">
        {extra}
        <div className="ml-auto flex items-center gap-2">
          {busyThread && (
            <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
              <Icon name="clock" size={12} /> {status === 'queued' ? 'Queued' : 'Will queue'}
            </span>
          )}
          <span className="hidden text-[11.5px] text-fg-4 sm:inline">
            <Kbd>{isMac ? 'Cmd' : 'Ctrl'}</Kbd> <Kbd>Enter</Kbd>
          </span>
          <Button variant="primary" size="sm" onClick={submit} busy={busy} disabled={!text.trim()} icon="send">
            {busyThread ? 'Queue' : 'Send'}
          </Button>
        </div>
      </div>
      {error && <ErrorNote className="m-2 mt-0">{error}</ErrorNote>}
    </div>
  );
}
