import type { CrewQuestion } from '@omni/shared/question.ts';
import { useApi } from '../../api.ts';
import { href } from '../../router.ts';
import { useFeed } from '../../store.tsx';
import { Icon } from '../ui.tsx';
import { QuestionCard } from './QuestionCard.tsx';

/**
 * The questions the threads delegated from this one wait on, at any depth, so Ben answers them where he works. Each card
 * answers its own thread's question, which returns to that thread's waiting call. Gone once answered here or there.
 */
export function CrewQuestions({ threadId, touch, onOpen }: { threadId: string; touch?: boolean; onOpen?: (threadId: string) => void }) {
  const { data, reload } = useApi<{ items: CrewQuestion[] }>(`/threads/${encodeURIComponent(threadId)}/crew-questions`);
  // Every ask and answer, here or synced from the other Mac, sends one.
  useFeed((e) => {
    if (e.type === 'needs_you') reload();
  });
  return data?.items.length ? <CrewQuestionList items={data.items} touch={touch} onOpen={onOpen} /> : null;
}

/** One card per question, under the thread that asked it, which the link opens (`onOpen` instead, on the phone). */
export function CrewQuestionList({ items, touch, onOpen }: { items: CrewQuestion[]; touch?: boolean; onOpen?: (threadId: string) => void }) {
  return (
    <section aria-label="Questions from delegated threads" className="flex flex-col gap-4">
      {items.map((c) => (
        <div key={c.question.id} className="flex flex-col gap-1.5">
          <a
            href={href.thread(c.thread_id)}
            title={`Open thread: ${c.thread_title}`}
            onClick={
              onOpen &&
              ((e) => {
                e.preventDefault();
                onOpen(c.thread_id);
              })
            }
            className={`hov flex min-w-0 items-center gap-1.5 self-start rounded-full px-2 text-[12px] text-fg-3 [--hov:var(--surface)] ${touch ? 'min-h-11' : 'py-1'}`}
          >
            <Icon name="message" size={13} />
            <span className="truncate">{[c.task_id, c.thread_title].filter(Boolean).join(' · ')} asks</span>
          </a>
          <QuestionCard threadId={c.thread_id} q={c.question} touch={touch} />
        </div>
      ))}
    </section>
  );
}
