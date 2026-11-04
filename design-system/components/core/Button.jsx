import React from 'react';
import { Icon } from '../icons/Icon.jsx';
import { Loader } from '../brand/Loader.jsx';

/* Button from web/src/components/ui.tsx: pill, press-scale, Bencho hover wash on ghost. */
export function Button({ variant = 'secondary', size = 'md', icon = null, kbd = null, busy = false, children, className = '', disabled, ...rest }) {
  const v = variant === 'danger' ? 'needs' : variant;
  const cls = ['om-btn', 'om-btn--' + v, size !== 'md' ? 'om-btn--' + size : '', className].filter(Boolean).join(' ');
  const isz = size === 'sm' ? 14 : 15;
  const lead = busy ? <Loader size={size === 'sm' ? 12 : 14} color="currentColor" /> : typeof icon === 'string' ? <Icon name={icon} size={isz} /> : icon;
  return (
    <button type="button" className={cls} disabled={disabled || busy} {...rest}>
      {lead}
      {children != null && <span>{children}</span>}
      {kbd && <span className="om-btn__kbd">{kbd}</span>}
    </button>
  );
}
