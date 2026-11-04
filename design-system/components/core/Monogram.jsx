import React from 'react';
import { Icon } from '../icons/Icon.jsx';

const PX = { sm: 20, md: 28, lg: 32, xl: 44 };

/* Letter avatar from web/src ui.tsx, minus the per-name hue: channels are told apart by name, not color. */
export function Monogram({ code, name, size = 'md', selected = false, icon, title }) {
  const px = typeof size === 'number' ? size : PX[size] || 28;
  const label = code || (name ? name.replace(/[^a-z0-9]/gi, '').slice(0, 1) : '?');
  return (
    <span className={'om-avatar' + (selected ? ' om-avatar--ink' : '')} style={{ width: px, height: px, fontSize: Math.round(px * 0.42) }} title={title} aria-hidden={!title}>
      {icon ? <Icon name={icon} size={Math.round(px * 0.5)} /> : String(label).slice(0, 2)}
    </span>
  );
}

export function TaskId({ id, onClick, href }) {
  if (href) return <a className="om-tid" href={href}>{id}</a>;
  if (onClick) return <button type="button" className="om-tid" onClick={onClick}>{id}</button>;
  return <span className="om-tid">{id}</span>;
}

export function Chip({ children, tone = 'default', title, className = '' }) {
  return <span title={title} className={'om-chip' + (tone !== 'default' ? ' om-chip--' + tone : '') + (className ? ' ' + className : '')}>{children}</span>;
}
