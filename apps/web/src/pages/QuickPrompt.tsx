import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DesktopBridge } from '@omni/shared/desktop-bridge.ts';
import { api, errorText, type ChannelWithRunning, type Thread } from '../api.ts';
import { useAutosize } from '../components/composer/controls.tsx';
import { pickerOptions } from '../components/composer/pickerOptions.tsx';
import { Icon, Loader, Picker } from '../components/ui.tsx';
import { href } from '../router.ts';
import {
  canSend,
  CONDUCTOR,
  dictationSettled,
  editingHint,
  quickPromptKey,
  quickPromptThread,
  reopened,
  sentLabel,
  type QuickPromptPhase,
} from './quick-prompt-model.ts';

// The desktop app's Quick Prompt panel (#/quick-prompt), in a frameless, transparent window that floats over other
// apps (apps/desktop/src/quick-prompt.ts): where the prompt goes, the field, and a line that says what is happening.
// Return starts a thread without bringing Omni forward; Cmd-Return opens it.

const SENT_LINGER_MS = 1400;
const MENU_SHADOW = 16;

export function QuickPromptPage({ bridge }: { bridge: DesktopBridge }) {
  const mac = bridge.platform === 'darwin';
  const [text, setTextState] = useState('');
  const [channel, setChannel] = useState(CONDUCTOR);
  const [phase, setPhaseState] = useState<QuickPromptPhase>({ kind: 'editing' });
  const [listening, setListeningState] = useState(false);
  const [wispr, setWispr] = useState(false);
  const [channels, setChannels] = useState<ChannelWithRunning[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // Read from timers and bridge events, which outlive a render.
  const live = useRef({ text, channel, phase, listening, lastEdit: Date.now() });
  live.current.channel = channel;
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Counts showings. Hiding bumps it too, so an open that resolves after the panel hid starts nothing.
  const shown = useRef(0);
  useAutosize(field, text, 19 * 1.45 * 10);

  const setText = useCallback((v: string) => {
    if (v !== live.current.text) live.current.lastEdit = Date.now();
    live.current.text = v;
    setTextState(v);
    if (live.current.phase.kind === 'failed') setPhase({ kind: 'editing' });
  }, []);
  const setPhase = (p: QuickPromptPhase) => {
    live.current.phase = p;
    setPhaseState(p);
  };
  const setListening = useCallback(
    (on: boolean) => {
      if (live.current.listening === on) return;
      live.current.listening = on;
      setListeningState(on);
      bridge.wispr(on ? 'start' : 'stop');
    },
    [bridge],
  );

  /** The panel just showed: a fresh prompt, the caret in the field, and Wispr Flow listening when asked for. */
  const opened = useCallback(async () => {
    const showing = ++shown.current;
    clearTimeout(closing.current);
    const next = reopened(live.current.phase, live.current.channel);
    setPhase(next.phase);
    setChannel(next.channel);
    field.current?.focus();
    const end = live.current.text.length;
    field.current?.setSelectionRange(end, end);
    api
      .get<ChannelWithRunning[]>('/channels')
      .then(setChannels)
      .catch(() => {});
    const [settings, status] = await Promise.all([bridge.settings.get(), bridge.quickPrompt.status()]);
    setWispr(status.wispr);
    if (showing !== shown.current || !status.visible || !settings.quickPrompt.dictate || !status.wispr) return;
    // A turn later, so the field has the focus before Flow reads it.
    setTimeout(() => {
      if (showing === shown.current) setListening(true);
    }, 0);
  }, [bridge, setListening]);

  const done = useCallback((route?: string) => {
    clearTimeout(closing.current);
    bridge.quickPrompt.done(route);
  }, [bridge]);

  useEffect(() => {
    const off = bridge.onEvent((e) => {
      if (e.type !== 'quick-prompt') return;
      if (e.action === 'open') void opened();
      else if (e.action === 'shortcut') {
        // While Flow listens, the shortcut stops it so its words land; otherwise it closes the panel.
        if (live.current.listening) setListening(false);
        else done();
      } else {
        shown.current++;
        clearTimeout(closing.current);
        if (live.current.listening) setListening(false);
      }
    });
    // The first open happens before this page has loaded; the status says whether it shows already.
    void bridge.quickPrompt.status().then((s) => {
      setWispr(s.wispr);
      if (s.visible) void opened();
    });
    return off;
  }, [bridge, opened, setListening, done]);

  // Escape closes, unless a menu in the panel took it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) done();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done]);

  // The window is see-through around the rounded panel, and sized to it.
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const el = root.current;
    if (!el) return;
    let last = 0;
    const fit = () => {
      // An open menu hangs below the panel, with its shadow under it.
      const h = Math.ceil(el.scrollHeight) + (el.querySelector('[aria-expanded="true"]') ? MENU_SHADOW : 0);
      if (h !== last) bridge.quickPrompt.resize((last = h));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // A menu opening below the picker grows the panel too, once it has animated to its full size.
    const mo = new MutationObserver(fit);
    mo.observe(el, { childList: true, subtree: true });
    el.addEventListener('animationend', fit);
    return () => (ro.disconnect(), mo.disconnect(), el.removeEventListener('animationend', fit));
  }, [bridge]);

  // The theme is picked in a main window; this one follows it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'omni.theme') return;
      const t = (() => {
        try {
          return JSON.parse(e.newValue ?? '"system"');
        } catch {
          return 'system';
        }
      })();
      if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
      else delete document.documentElement.dataset.theme;
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Waits for Wispr Flow's words to land. Returns whether anything is left to send. */
  const awaitDictation = () =>
    new Promise<boolean>((resolve) => {
      setPhase({ kind: 'finishing' });
      const start = Date.now();
      const before = live.current.text;
      const tick = () => {
        if (!dictationSettled({ before, text: live.current.text, lastEdit: live.current.lastEdit, start, now: Date.now() })) return void setTimeout(tick, 50);
        if (live.current.phase.kind === 'finishing') setPhase({ kind: 'editing' });
        resolve(live.current.text.trim() !== '');
      };
      tick();
    });

  const submit = async (open: boolean) => {
    if (live.current.listening) {
      setListening(false);
      if (!(await awaitDictation())) return;
    }
    const body = quickPromptThread(live.current.text, live.current.channel);
    if (!body || !canSend(live.current.text, live.current.phase)) return;
    setPhase({ kind: 'sending' });
    try {
      const thread = await api.post<Thread>('/threads', body);
      setText('');
      setPhase({ kind: 'sent', thread: { id: thread.id, title: thread.title ?? '' } });
      if (open) return done(href.thread(thread.id));
      closing.current = setTimeout(() => done(), SENT_LINGER_MS);
    } catch (err) {
      setPhase({ kind: 'failed', message: errorText(err) });
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const { key, metaKey, ctrlKey, shiftKey, altKey, keyCode } = e;
    const action = quickPromptKey({ key, metaKey, ctrlKey, shiftKey, altKey, keyCode, isComposing: e.nativeEvent.isComposing });
    if (!action) return;
    e.preventDefault();
    void submit(action === 'send-open');
  };

  const listed = channels.filter((c) => !c.archived);
  const { channelOptions } = pickerOptions(listed, channel, []);
  if (!channelOptions.some((o) => o.value === CONDUCTOR)) channelOptions.unshift({ value: CONDUCTOR, label: 'Conductor', avatar: 'Conductor', icon: 'target' });

  return (
    <div ref={root} className="w-full">
      <div className="space-y-3 rounded-[18px] border border-[var(--line-strong)] bg-bg px-[18px] pt-3 pb-3.5 text-fg">
        <div className="flex items-center gap-2.5">
          <Picker label="Send to" value={channel} options={channelOptions} onChange={setChannel} searchable={channelOptions.length > 7} />
          <span className="flex-1" />
          {wispr && (
            <button
              type="button"
              aria-label={listening ? 'Stop Wispr Flow' : 'Dictate with Wispr Flow'}
              title={listening ? 'Stop Wispr Flow' : 'Dictate with Wispr Flow'}
              data-on={listening || undefined}
              onClick={() => {
                field.current?.focus();
                setListening(!listening);
              }}
              className={`hov press grid h-7 w-7 place-items-center rounded-full transition-colors ${listening ? 'bg-surface-2 text-needs' : 'text-fg-3 hover:text-fg'}`}
            >
              <Icon name="mic" size={15} className={listening ? 'animate-pulse' : ''} />
            </button>
          )}
        </div>
        <textarea
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          autoFocus
          aria-label="Prompt"
          placeholder={channel === CONDUCTOR ? 'Ask the Conductor anything' : 'Describe the task'}
          className="block w-full resize-none bg-transparent text-[19px] leading-[1.45] text-fg outline-none placeholder:text-fg-4"
        />
        <Footer phase={phase} listening={listening} mac={mac} onOpen={(id) => done(href.thread(id))} />
      </div>
    </div>
  );
}

function Footer({ phase, listening, mac, onOpen }: { phase: QuickPromptPhase; listening: boolean; mac: boolean; onOpen: (id: string) => void }) {
  return (
    <div className="flex min-h-[18px] items-center gap-2 text-[12px] text-fg-3" aria-live="polite">
      {phase.kind === 'editing' && listening ? (
        <>
          <Icon name="mic" size={13} className="text-needs" />
          <span>Listening. Speak, then press Return to send.</span>
        </>
      ) : phase.kind === 'editing' ? (
        <span>{editingHint(mac)}</span>
      ) : phase.kind === 'finishing' ? (
        <>
          <Loader size={13} />
          <span>Waiting for Wispr Flow…</span>
        </>
      ) : phase.kind === 'sending' ? (
        <>
          <Loader size={13} />
          <span>Sending…</span>
        </>
      ) : phase.kind === 'sent' ? (
        <>
          <Icon name="check" size={13} className="text-fg" />
          <span className="min-w-0 truncate">{sentLabel(phase.thread.title)}</span>
          <button type="button" onClick={() => onOpen(phase.thread.id)} className="shrink-0 font-medium text-fg underline-offset-2 hover:underline">
            Open
          </button>
        </>
      ) : (
        <>
          <Icon name="alert" size={13} className="shrink-0 text-warn" />
          <span className="line-clamp-2">{phase.message}</span>
        </>
      )}
    </div>
  );
}
