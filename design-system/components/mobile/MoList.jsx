import React from 'react';
import { Icon } from '../icons/Icon.jsx';

/* Inset group on surface: settings, channels, checks, files. */
export function MoGroup({ children }) {
  return <div className="om-mo-group">{children}</div>;
}

/* A grouped-list row: 52pt minimum, icon, label and sub, a value or control on the right, a chevron when it pushes.
   The hairline starts after the icon. No red labels: the pops mean status only, so Archive reads like any other row. */
export function MoListRow({ icon, label, sub, value, right, onPress, chevron, last = false }) {
  const pushes = chevron ?? !!onPress;
  const cls = 'om-mo-lrow' + (last ? ' om-mo-lrow--last' : '');
  const Tag = onPress ? 'button' : 'div';
  return (
    <Tag type={onPress ? 'button' : undefined} className={cls} onClick={onPress} data-press={onPress ? '' : undefined}>
      {icon && <span className="om-mo-lrow__icon">{typeof icon === 'string' ? <Icon name={icon} size={18} /> : icon}</span>}
      <span className="om-mo-lrow__body">
        <span className="om-mo-lrow__text">
          <span className="om-mo-lrow__label om-mo-ellipsis">{label}</span>
          {sub && <span className="om-mo-lrow__sub om-mo-ellipsis">{sub}</span>}
        </span>
        {(value != null || right) && <span className="om-mo-lrow__value">{value}{right}</span>}
        {pushes && <span className="om-mo-lrow__chev"><Icon name="chevronRight" size={16} /></span>}
      </span>
    </Tag>
  );
}

export function MoRadio({ on }) {
  return <span className={'om-mo-radio' + (on ? ' om-mo-radio--on' : '')} aria-hidden="true" />;
}
