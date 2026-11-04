import React from 'react';

/* Your message, right-aligned in a surface-2 bubble, who sent it above. sending fades it; failed puts the reason in the caption. */
export function MoBubble({ caption, state = 'sent', children }) {
  return (
    <div className={'om-mo-bubble' + (state !== 'sent' ? ' om-mo-bubble--' + state : '')}>
      {caption && <span className="om-mo-bubble__cap">{caption}</span>}
      <div className="om-mo-bubble__body">{children}</div>
    </div>
  );
}
