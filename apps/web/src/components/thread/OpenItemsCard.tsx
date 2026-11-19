import { useState } from 'react';
import { api, errorText, type Thread } from '../../api.ts';
import { answersMessage, OPEN_ITEM_LABEL, readOpenItems, spawnPrompt, type OpenItem } from '@omni/shared/open-items.ts';
import { Button, ErrorNote, IconButton } from '../ui.tsx';
import { isImeEnter } from '../../ime.ts';

type Busy = 'send' | 'dismiss-all' | `dismiss:${number}`;

/** The answers typed for items still on the card. */
const keep = (answers: Record<string, string>, items: readonly OpenItem[]) =>
  Object.fromEntries(items.flatMap((i) => (answers[i.text] ? [[i.text, answers[i.text]]] : [])));

/**
 * What the finished turn left open for Ben (apps/server/runner/aux.ts): questions it asked him, decisions it left to
 * him and blockers only he can clear. Answers typed or picked here go back as one reply; New thread opens a composer
 * with one item as its first prompt; Dismiss drops an item, the x drops the card. Any reply drops it too, and the next
 * turn reads what is still open.
 */
export function OpenItemsCard({
  thread,
  onThread,
  onSpawn,
  mobile,
}: {
  thread: Thread;
  onThread: (t: Thread, reply?: boolean) => void;
  /** Open a new-thread composer with this first prompt. Each surface has its own. */
  onSpawn: (prompt: string) => void;
  mobile?: boolean;
}) {
  const items = readOpenItems(thread.open_items);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Answers belong to this set of items. A reply from the composer clears the set, and a later turn can ask the same
  // question again: that one starts empty, never with what was typed for the last one. Only a dismiss, which leaves
  // some of the same items, keeps what was typed on the rest.
  const [answeredFor, setAnsweredFor] = useState(thread.open_items);
  if (answeredFor !== thread.open_items) {
    setAnsweredFor(thread.open_items);
    const before = new Set(readOpenItems(answeredFor).map((i) => i.text));
    setAnswers(items.length && items.every((i) => before.has(i.text)) ? (a) => keep(a, items) : {});
  }
  if (!items.length || thread.status !== 'done') return null;

  const path = `/threads/${encodeURIComponent(thread.id)}`;
  const reply = answersMessage(items, items.map((i) => answers[i.text]));
  const setAnswer = (item: OpenItem, text: string) => setAnswers((a) => ({ ...a, [item.text]: text }));
  const run = async (what: Busy, call: () => Promise<void>) => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try {
      await call();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const send = () =>
    run('send', async () => {
      if (!reply) return;
      onThread(await api.post<Thread>(`${path}/messages`, { prompt: reply }), true);
      setAnswers({});
    });
  const dismissAll = () => run('dismiss-all', async () => onThread(await api.patch<Thread>(path, { open_items: null })));
  const dismiss = (item: OpenItem, i: number) =>
    run(`dismiss:${i}`, async () => onThread(await api.patch<Thread>(path, { dismiss_open_item: item.text })));

  const count = items.length;
  return (
    <section aria-label="Open items" className="pop-in mt-6 overflow-hidden rounded-2xl border border-line bg-surface sm:max-w-[560px]">
      <div className="flex items-center gap-2 bg-surface-2 py-1 pr-2 pl-4">
        <span className="flex-1 text-[12px] font-medium text-fg-3">
          {count === 1 ? 'Open item' : `${count} open items`} before this thread is done
        </span>
        <IconButton icon="x" label="Dismiss all" size={14} disabled={!!busy} onClick={() => void dismissAll()} />
      </div>
      <ol className="divide-y divide-line">
        {items.map((item, i) => {
          const value = answers[item.text] ?? '';
          return (
            <li key={item.text} className="px-4 pt-3 pb-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-medium tracking-[0.02em] text-fg-3 uppercase">{OPEN_ITEM_LABEL[item.kind]}</div>
                  {/* All of it, never clamped: New thread starts from exactly this. */}
                  <p className="mt-0.5 text-[14px] leading-snug break-words">{item.text}</p>
                </div>
                <div className="-mt-1 -mr-2 flex shrink-0 items-center">
                  <IconButton
                    icon="plus"
                    label="New thread for this"
                    size={14}
                    disabled={!!busy}
                    onClick={() => onSpawn(spawnPrompt(item, thread.title))}
                  />
                  <IconButton
                    icon="x"
                    label="Dismiss"
                    size={14}
                    disabled={!!busy}
                    onClick={() => void dismiss(item, i)}
                  />
                </div>
              </div>
              {item.options && (
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Options">
                  {item.options.map((o) => (
                    <Button
                      key={o}
                      size="sm"
                      variant={value === o ? 'primary' : 'secondary'}
                      aria-pressed={value === o}
                      disabled={!!busy}
                      onClick={() => setAnswer(item, value === o ? '' : o)}
                    >
                      {o}
                    </Button>
                  ))}
                </div>
              )}
              <input
                className={`field mt-2 !py-[7px] ${mobile ? '!text-[length:var(--fs-input)]' : 'field-sm'}`}
                placeholder={item.kind === 'blocker' ? 'Note, e.g. done' : item.options ? 'Or write your own answer' : 'Your answer'}
                aria-label={`Answer: ${item.text}`}
                value={value}
                disabled={busy === 'send'}
                onChange={(e) => setAnswer(item, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isImeEnter(e) && reply) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <span className="min-w-0 flex-1 pl-1 text-[12px] text-fg-3">Answers go back as one reply.</span>
        <Button size="sm" variant="primary" icon="send" busy={busy === 'send'} disabled={!reply || !!busy} onClick={() => void send()}>
          Send answers
        </Button>
      </div>
      {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
    </section>
  );
}
