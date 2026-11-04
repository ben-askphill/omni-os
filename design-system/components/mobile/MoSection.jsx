import React from 'react';

/* A list section: sentence-case caption, a quiet count, an optional trailing action. */
export function MoSection({ title, count, right, flush = false, children }) {
  return (
    <section className={'om-mo-section' + (flush ? ' om-mo-section--flush' : '')}>
      <div className="om-mo-section__head">
        <span className="om-mo-section__title">{title}</span>
        {count != null && <span className="om-mo-section__count">{count}</span>}
        <span className="grow" />
        {right}
      </div>
      {children}
    </section>
  );
}
