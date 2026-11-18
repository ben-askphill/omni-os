// A quick ask's answer, in the box it was asked from (Quick Prompt, the phone's New sheet): the questions and answers
// live from the thread's stream, a follow-up box, Copy, Keep as thread and Make it a task. The rules are
// packages/shared/quick-ask.ts; the server side is apps/server/quick-ask.ts.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { quickAskKey, quickAskView, promotedLine, suggestedLine, type QuickEvent } from '@omni/shared/quick-ask.ts';
import { api, errorText, useThreadStream, type EventRow, type Thread, type ThreadDetail } from '../api.ts';
import { Markdown } from './Markdown.tsx';
import { Button, copyText, Icon, Loader } from './ui.tsx';

/** A quick ask's thread and events, kept current from its stream. */
export function useQuickAsk(id: string) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [events, setEvents] = useState<QuickEvent[]>([]);
  const lastId = useRef(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let on = true;
    setReady(false);
    lastId.current = 0;
    api
      .get<ThreadDetail>(`/threads/${encodeURIComponent(id)}`)
      .then((d) => {
        if (!on) return;
        setThread(d.thread);
        setEvents(d.events);
        lastId.current = d.events.at(-1)?.id ?? 0;
        setReady(true);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [id]);
  useThreadStream(id, ready, lastId, (m) => {
    if (m.type === 'thread') setThread(m.thread);
    else if (m.type === 'sync') {
      setThread(m.detail.thread);
      if (m.snapshot) setEvents(m.detail.events as EventRow[]);
    } else if (m.type === 'event' && m.event.id > lastId.current) {
      lastId.current = m.event.id;
      setEvents((prev) => [...prev, m.event]);
    }
  });
  return { thread, view: thread ? quickAskView(thread, events) : null };
}

/**
 * `onOpen`: show a thread in Omni (the task it became, or the ask once kept). `onTask`: a task was made from it.
 * `touch`: the phone's sizes.
 */
export function QuickAnswer({ id, onOpen, touch = false }: { id: string; onOpen: (threadId: string) => void; touch?: boolean }) {
  const { thread, view } = useQuickAsk(id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'send' | 'keep' | 'task' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The newest question and its answer stay in view as they come in.
  const tail = view ? `${view.turns.length}:${view.turns.at(-1)?.answer?.length ?? 0}` : '';
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [tail]);

  const act = useCallback(
    async (what: 'send' | 'keep' | 'task', open = false) => {
      setBusy(what);
      setError(null);
      try {
        if (what === 'send') {
          if (!text.trim()) return;
          await api.post(`/threads/${encodeURIComponent(id)}/messages`, { prompt: text.trim(), mode: 'queue' });
          setText('');
        } else {
          const r = await api.post<{ ask: Thread; task?: Thread }>(`/threads/${encodeURIComponent(id)}/promote`, { to: what, ...(what === 'task' && text.trim() && { request: text.trim() }) });
          setText('');
          if (open || what === 'keep') onOpen(r.task?.id ?? r.ask.id);
        }
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(null);
      }
    },
    [id, text, onOpen],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const { key, metaKey, ctrlKey, shiftKey, altKey, keyCode } = e;
    const k = quickAskKey({ key, metaKey, ctrlKey, shiftKey, altKey, keyCode, isComposing: e.nativeEvent.isComposing });
    if (!k) return;
    e.preventDefault();
    void act(k === 'ask' ? 'send' : 'task', k === 'task-open');
  };

  if (!thread || !view) return <Loader size={14} />;
  const size = touch ? 'text-[15px]' : 'text-[14px]';
  const done = view.promoted || view.kept;
  return (
    <section aria-label="Answer" className="flex flex-col gap-3" aria-busy={view.busy || undefined}>
      <div ref={list} className="flex max-h-[min(60vh,420px)] flex-col gap-3 overflow-y-auto">
        {!view.turns.length && (
          <div className="flex items-center gap-2 text-[12.5px] text-fg-3" aria-live="polite">
            <Loader size={13} />
            Thinking
          </div>
        )}
        {view.turns.map((t, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className={`${size} font-medium text-fg-2`}>{t.question}</div>
            {t.answer ? (
              <div className={size}>
                <Markdown text={t.answer} />
              </div>
            ) : view.busy && i === view.turns.length - 1 ? (
              <div className="flex items-center gap-2 text-[12.5px] text-fg-3" aria-live="polite">
                <Loader size={13} />
                Thinking
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {view.promoted ? (
        <div className="flex items-center gap-2 text-[12.5px] text-fg-2" aria-live="polite">
          <Icon name="check" size={13} className="shrink-0 text-fg-3" />
          <span className="min-w-0 flex-1 truncate">{promotedLine()}</span>
          <Button size="sm" variant="secondary" onClick={() => onOpen(view.promoted!.thread_id)}>
            Open task
          </Button>
        </div>
      ) : view.kept ? (
        <div className="flex items-center gap-2 text-[12.5px] text-fg-2">
          <Icon name="check" size={13} className="shrink-0 text-fg-3" />
          <span className="min-w-0 flex-1">Kept as a thread.</span>
          <Button size="sm" variant="secondary" onClick={() => onOpen(id)}>
            Open
          </Button>
        </div>
      ) : view.suggested ? (
        <div className="flex items-center gap-2 text-[12.5px] text-fg-2" aria-live="polite">
          <Icon name="alert" size={13} className="shrink-0 text-fg-3" />
          <span className="min-w-0 flex-1">{suggestedLine(view.suggested.title)}</span>
        </div>
      ) : null}
      {!done && (
        <>
          <textarea
            ref={field}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            aria-label="Follow-up"
            placeholder="Ask a follow-up"
            className={`block w-full resize-none rounded-[var(--r-xl)] bg-surface px-3 py-2 ${touch ? 'text-[16px]' : 'text-[14px]'} leading-[1.5] text-fg outline-none placeholder:text-fg-4`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={copied ? 'check' : 'copy'}
              disabled={!view.copy}
              onClick={() => view.copy && void copyText(view.copy).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" variant="secondary" busy={busy === 'keep'} disabled={view.busy} onClick={() => void act('keep')}>
              Keep as thread
            </Button>
            <Button size="sm" variant={view.suggested ? 'primary' : 'secondary'} busy={busy === 'task'} onClick={() => void act('task', true)}>
              Make it a task
            </Button>
          </div>
        </>
      )}
      {error && (
        <div className="flex items-center gap-2 text-[12.5px] text-fg-2">
          <Icon name="alert" size={13} className="shrink-0 text-warn" />
          <span className="line-clamp-2">{error}</span>
        </div>
      )}
    </section>
  );
}
