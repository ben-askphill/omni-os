import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import {
  answersOf,
  answerWords,
  canAdvance,
  choose,
  isLastPage,
  newDraft,
  OTHER_MAX,
  type Answer,
  type Draft,
  type Question,
  type QuestionState,
  type ThreadQuestion,
} from '@omni/shared/question.ts';
import { api, ApiError, errorText } from '../../api.ts';
import { Button, Chip, ErrorNote, Icon, IconButton, StatusPill } from '../ui.tsx';

/** The status a thread shows while a question waits on Ben, in its header and under the card. */
export const ASKING_LABEL = 'Needs your input';

const STATE_LABEL: Record<Exclude<QuestionState, 'pending'>, string> = { answered: 'Answered', skipped: 'Skipped', dismissed: 'Not answered' };

/** A 409 for a question someone answered first carries the state that answer left. */
const answeredAlready = (body: unknown) => !!body && typeof body === 'object' && 'state' in body;

type Settled = { state: Exclude<QuestionState, 'pending'>; answers: Answer[] | null };

/**
 * A question the agent asked with ask_user_question (packages/shared/question.ts): Ben answers it in place, one question
 * a page. Once answered, skipped or dismissed it folds to what he said. `touch` gives the phone 44px targets.
 */
export function QuestionCard({ threadId, q, touch }: { threadId: string; q: ThreadQuestion; touch?: boolean }) {
  // What Ben sent, until the stream brings the answer event.
  const [sent, setSent] = useState<Settled | null>(null);
  if (q.state !== 'pending') return <Summary questions={q.questions} state={q.state} answers={q.answers} />;
  if (sent) return <Summary questions={q.questions} {...sent} />;
  return <Asking threadId={threadId} q={q} touch={touch} onSent={setSent} />;
}

function Summary({ questions, state, answers }: { questions: Question[] } & Settled) {
  return (
    <section aria-label="Question" className="w-full rounded-[22px] bg-surface px-4 pt-3 pb-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="caption">{questions.length > 1 ? 'Questions' : 'Question'}</span>
        <span className="ml-auto text-[12px] text-fg-3">{STATE_LABEL[state]}</span>
      </div>
      <dl className="flex flex-col gap-2.5">
        {questions.map((x, i) => (
          <div key={i} className="min-w-0">
            <dt className="text-[12.5px] leading-snug text-fg-3">{x.question}</dt>
            {answers && <dd className="mt-0.5 text-[14px] leading-snug break-words text-fg">{answerWords(answers[i])}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

function Asking({ threadId, q, touch, onSent }: { threadId: string; q: ThreadQuestion; touch?: boolean; onSent: (s: Settled) => void }) {
  const { questions } = q;
  const [draft, setDraft] = useState<Draft>(() => newDraft(questions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const otherField = useRef<HTMLInputElement>(null);
  const shown = questions[draft.page];
  const pick = draft.picks[draft.page];
  const multi = shown.multiSelect;
  const labels: (string | null)[] = [...shown.options.map((o) => o.label), null];
  const checked = (label: string | null) => (label === null ? pick.otherOn : pick.selected.includes(label));
  const current = Math.max(0, labels.findIndex(checked));
  const ready = canAdvance(draft);
  const last = isLastPage(draft);

  // The card takes focus when it appears and on each page, on the row that is chosen.
  useEffect(() => {
    rows.current[current]?.focus({ preventScroll: true });
  }, [draft.page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pick.otherOn) otherField.current?.focus({ preventScroll: true });
  }, [pick.otherOn]);

  const choosing = (label: string | null) => setDraft((d) => ({ ...d, picks: d.picks.map((p, i) => (i === d.page ? choose(questions[i], p, label) : p)) }));
  const typing = (text: string) => setDraft((d) => ({ ...d, picks: d.picks.map((p, i) => (i === d.page ? { ...p, other: text } : p)) }));

  const send = async (d: Draft) => {
    const answers = answersOf(d);
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ state: Settled['state'] }>(`/threads/${encodeURIComponent(threadId)}/questions/${encodeURIComponent(q.id)}/answer`, { answers });
      onSent({ state: res.state, answers });
    } catch (e) {
      // Answered already, from another device or by a message: the stream brings that answer. Any other refusal says why.
      if (!(e instanceof ApiError && e.status === 409 && answeredAlready(e.body))) setError(errorText(e));
      setBusy(false);
    }
  };

  /** Next, or Send on the last page. Skip marks the shown question skipped first. */
  const advance = (skip: boolean) => {
    if (busy || (!skip && !ready)) return;
    const next = { ...draft, skipped: draft.skipped.map((s, i) => (i === draft.page ? skip : s)) };
    if (last) void send(next);
    else setDraft({ ...next, page: draft.page + 1 });
  };
  const back = () => draft.page > 0 && setDraft((d) => ({ ...d, page: d.page - 1 }));
  const forward = () => !last && advance(false);

  const onKey = (e: KeyboardEvent) => {
    const inField = e.target === otherField.current;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || inField)) {
      e.preventDefault();
      advance(false);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inField && questions.length > 1) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') back();
      else forward();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const at = inField ? labels.length - 1 : rows.current.indexOf(document.activeElement as HTMLButtonElement);
      const to = at < 0 ? current : (at + (e.key === 'ArrowDown' ? 1 : -1) + labels.length) % labels.length;
      rows.current[to]?.focus();
      if (!multi) choosing(labels[to]);
    }
  };

  const nav = touch ? 'h-11 w-11' : '';
  return (
    <div className="flex w-full flex-col items-start gap-2">
      <section aria-label="Question from the agent" onKeyDown={onKey} className="pop-in w-full overflow-hidden rounded-[22px] bg-surface">
        <div className="flex items-start gap-2 bg-surface-2 px-4 py-3">
          <div className="min-w-0 flex-1 py-1">
            {shown.header && (
              <Chip tone="outline" className="mb-1.5">
                {shown.header}
              </Chip>
            )}
            <h3 id={`q-${q.id}-${draft.page}`} className="text-[14px] leading-snug font-semibold text-pretty">
              {shown.question}
            </h3>
          </div>
          {questions.length > 1 && (
            <div className="-mr-2 flex shrink-0 items-center">
              <IconButton icon="chevronLeft" label="Previous question" className={nav} disabled={draft.page === 0} onClick={back} />
              <span className="font-num text-[12px] text-fg-3 tabular-nums">
                {draft.page + 1} of {questions.length}
              </span>
              <IconButton icon="chevronRight" label="Next question" className={nav} disabled={last || !ready || busy} onClick={forward} />
            </div>
          )}
        </div>
        <div role={multi ? 'group' : 'radiogroup'} aria-labelledby={`q-${q.id}-${draft.page}`}>
          {labels.map((label, i) => {
            const o = label === null ? null : shown.options[i];
            return (
              <Row
                key={`${draft.page}-${label ?? '\0other'}`}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                multi={multi}
                on={checked(label)}
                tabbable={multi || i === current}
                touch={touch}
                label={o ? o.label : 'Other'}
                description={o ? o.description : ''}
                onClick={() => choosing(label)}
              />
            );
          })}
          {pick.otherOn && (
            <div className="px-4 pb-3 pl-[46px]">
              <input
                ref={otherField}
                value={pick.other}
                onChange={(e) => typing(e.target.value)}
                maxLength={OTHER_MAX}
                aria-label="Your answer"
                placeholder="Type your answer"
                className={`w-full rounded-xl bg-bg px-3 text-[13.5px] text-fg outline-none placeholder:text-fg-4 shadow-[inset_0_0_0_1px_var(--line)] focus:shadow-[inset_0_0_0_1px_var(--line-strong)] ${touch ? 'h-11 text-[16px]' : 'h-9'}`}
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2.5">
          <Button size={touch ? 'lg' : 'sm'} variant="secondary" disabled={busy} onClick={() => advance(true)}>
            Skip
          </Button>
          <Button size={touch ? 'lg' : 'sm'} variant="primary" disabled={!ready} busy={busy} onClick={() => advance(false)} aria-keyshortcuts="Meta+Enter">
            {last ? 'Send' : 'Next'}
            {!touch && <kbd className="font-sans text-[11px] opacity-60">⌘↵</kbd>}
          </Button>
        </div>
        {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
      </section>
      <StatusPill status="needs" label={ASKING_LABEL} />
    </div>
  );
}

function Row({
  ref,
  multi,
  on,
  tabbable,
  touch,
  label,
  description,
  onClick,
}: {
  ref: Ref<HTMLButtonElement>;
  multi: boolean;
  on: boolean;
  tabbable: boolean;
  touch?: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={on}
      tabIndex={tabbable ? 0 : -1}
      onClick={onClick}
      className={`hov flex w-full items-start gap-3 border-t border-line px-4 text-left [--hov:var(--surface-2)] first:border-t-0 ${touch ? 'min-h-11 py-3' : 'py-2.5'}`}
    >
      <span
        aria-hidden="true"
        className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center ${multi ? 'rounded-[5px]' : 'rounded-full'} ${on ? 'bg-fg text-on-ink' : 'shadow-[inset_0_0_0_1.5px_var(--line-strong)]'}`}
      >
        {on && (multi ? <Icon name="check" size={12} strokeWidth={2.6} /> : <span className="h-1.5 w-1.5 rounded-full bg-on-ink" />)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] leading-snug font-semibold">{label}</span>
        {description && <span className="text-[12.5px] leading-snug text-pretty text-fg-3">{description}</span>}
      </span>
    </button>
  );
}
