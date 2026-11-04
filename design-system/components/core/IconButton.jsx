import React from 'react';
import { Icon } from '../icons/Icon.jsx';

export function IconButton({ label, icon, iconSize = 16, size = 'md', pressed, active, children, className = '', ...rest }) {
  const on = pressed || active;
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} data-on={on || undefined} className={'om-iconbtn' + (size === 'sm' ? ' om-iconbtn--sm' : '') + (className ? ' ' + className : '')} {...rest}>
      {icon ? <Icon name={icon} size={iconSize} /> : children}
    </button>
  );
}
