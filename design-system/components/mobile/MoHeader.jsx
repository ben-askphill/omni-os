import React from 'react';
import { MoRoundButton } from './MoButtons.jsx';

/* Pushed-screen header: back, one-line title and subtitle, at most two trailing actions. Clears the status bar unless flush. */
export function MoHeader({ title, sub, onBack, left, right, flush = false }) {
  return (
    <header className={'om-mo-header' + (flush ? ' om-mo-header--flush' : '')}>
      <div className="om-mo-header__bar">
        {onBack ? <MoRoundButton icon="chevronLeft" label="Back" onPress={onBack} /> : left}
        <div className="om-mo-header__text">
          {title && <div className="om-mo-header__title om-mo-ellipsis">{title}</div>}
          {sub && <div className="om-mo-header__sub om-mo-ellipsis">{sub}</div>}
        </div>
        {right && <div className="om-mo-header__right">{right}</div>}
      </div>
    </header>
  );
}

/* Large title on tab roots only. The subtitle counts what matters now: needs you in ink, running in live text. */
export function MoLargeTitle({ title, sub, needs, running }) {
  const parts = [];
  if (sub) parts.push(<span key="s">{sub}</span>);
  if (running) parts.push(<span key="r" className="live">{running} running</span>);
  if (needs) parts.push(<b key="n" className="needs">{needs} need{needs === 1 ? 's' : ''} you</b>);
  return (
    <div className="om-mo-title">
      <h1>{title}</h1>
      {parts.length > 0 && <div className="om-mo-title__sub">{parts.reduce((acc, p, i) => (i ? [...acc, ' · ', p] : [p]), [])}</div>}
    </div>
  );
}
