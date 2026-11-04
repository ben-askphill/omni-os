import React from 'react';
import { StatusGlyph } from '../core/Status.jsx';

/* Ink pill that springs up above the tab bar: what just happened, in a few words. status adds its glyph. */
export function MoToast({ status, placement = 'float', children }) {
  return (
    <div className={'om-mo-toast' + (placement === 'static' ? ' om-mo-toast--static' : '')} role="status">
      {status && <StatusGlyph state={status} size={8} />}
      {children}
    </div>
  );
}
