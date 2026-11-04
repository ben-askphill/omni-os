import React from 'react';
import { Icon } from '../icons/Icon.jsx';
import { Button } from '../core/Button.jsx';
import { Status } from '../core/Status.jsx';

/* Question card (web/src components/thread/QuestionCard.tsx, apps/mac Omni/QuestionCard.swift): an agent's
   ask_user_question in the thread. Pending: grey header with the question and a pager, one row per option (radio, or
   checkbox on a multi select question), Other with a field, Skip and Next, then Send on the last page. Answered,
   skipped or not answered: a quiet read-only summary. The vermilion pill under a pending card says it waits on you. */
export function QuestionCard({ questions = [], answers = null, state = 'pending', touch = false, onSend }) {
  const [page, setPage] = React.useState(0);
  const [picks, setPicks] = React.useState(() => questions.map((q) => ({ selected: q.multiSelect ? [] : [q.options[0].label], otherOn: false, other: '' })));
  const [skipped, setSkipped] = React.useState(() => questions.map(() => false));

  if (state !== 'pending') {
    const words = (a) => (a ? [...a.selected, ...(a.other ? [a.other] : [])].join(', ') : 'Skipped');
    const label = state === 'answered' ? 'Answered' : state === 'skipped' ? 'Skipped' : 'Not answered';
    return (
      <section className="om-question om-question--done" aria-label="Questions from the agent">
        <div className="om-question__sumhead"><Icon name="check" size={12} />{label}</div>
        {questions.map((q, i) => (
          <div key={i} className="om-question__pair">
            <span className="om-question__asked">{q.question}</span>
            <span className={'om-question__said' + (answers && answers[i] ? '' : ' is-skipped')}>{answers ? words(answers[i]) : 'Not answered'}</span>
          </div>
        ))}
      </section>
    );
  }

  const q = questions[page];
  const p = picks[page];
  const last = page === questions.length - 1;
  const answer = (x) => { const other = x.otherOn ? x.other.trim() || null : null; return x.selected.length || other ? { selected: x.selected, other } : null; };
  const can = answer(p) !== null;
  const set = (next) => setPicks(picks.map((x, i) => (i === page ? next : x)));
  const choose = (label) => {
    if (!q.multiSelect) return set(label === null ? { ...p, selected: [], otherOn: true } : { ...p, selected: [label], otherOn: false });
    if (label === null) return set({ ...p, otherOn: !p.otherOn });
    const on = p.selected.includes(label);
    set({ ...p, selected: q.options.map((o) => o.label).filter((l) => (l === label ? !on : p.selected.includes(l))) });
  };
  const advance = (skip) => {
    const sk = skipped.map((s, i) => (i === page ? skip : s));
    setSkipped(sk);
    if (!last) return setPage(page + 1);
    onSend && onSend(picks.map((x, i) => (sk[i] ? null : answer(x))));
  };
  const rows = [...q.options.map((o) => ({ label: o.label, description: o.description, on: p.selected.includes(o.label) })), { label: null, description: null, on: p.otherOn }];

  return (
    <div className="om-question-wrap">
      <section className={'om-question' + (touch ? ' om-question--touch' : '')} aria-label="Question from the agent">
        <header className="om-question__head">
          <div className="om-question__titles">
            {q.header && <span className="om-question__tag">{q.header}</span>}
            <h3 className="om-question__q">{q.question}</h3>
          </div>
          {questions.length > 1 && (
            <div className="om-question__pager">
              <button type="button" className="om-iconbtn om-iconbtn--sm" aria-label="Previous question" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevronLeft" size={14} /></button>
              <span>{page + 1} of {questions.length}</span>
              <button type="button" className="om-iconbtn om-iconbtn--sm" aria-label="Next question" disabled={last || !can} onClick={() => advance(false)}><Icon name="chevronRight" size={14} /></button>
            </div>
          )}
        </header>
        <div role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question}>
          {rows.map((r, i) => (
            <div key={i}>
              <button type="button" role={q.multiSelect ? 'checkbox' : 'radio'} aria-checked={r.on} className={'om-question__row' + (r.on ? ' is-on' : '')} onClick={() => choose(r.label)}>
                <span className={'om-question__mark' + (q.multiSelect ? ' is-box' : '')} aria-hidden="true">{r.on && (q.multiSelect ? <Icon name="check" size={12} /> : <i />)}</span>
                <span className="om-question__text">
                  <b>{r.label ?? 'Other'}</b>
                  {r.description && <span>{r.description}</span>}
                </span>
              </button>
              {r.label === null && r.on && (
                <div className="om-question__other"><input className="om-input" placeholder="Type your own answer" value={p.other} onChange={(e) => set({ ...p, other: e.target.value })} /></div>
              )}
            </div>
          ))}
        </div>
        <footer className="om-question__foot">
          <Button size="sm" onClick={() => advance(true)}>Skip</Button>
          <Button size="sm" variant="primary" kbd={touch ? null : '⌘↵'} disabled={!can} onClick={() => advance(false)}>{last ? 'Send' : 'Next'}</Button>
        </footer>
      </section>
      <Status state="needs" label="Needs your input" />
    </div>
  );
}
