import React from 'react';
import { Icon } from '../icons/Icon.jsx';

/* Round button (kit MoRound, phone web RoundBtn): 40pt. surface-2 by default, ink for the one primary action, quiet on a surface. */
export function MoRoundButton({ icon, label, onPress, tone = 'default', size = 40, disabled, children }) {
  const cls = 'om-mo-round om-mo-press' + (tone !== 'default' ? ' om-mo-round--' + tone : '');
  return (
    <button type="button" className={cls} aria-label={label} title={label} onClick={onPress} disabled={disabled} style={size !== 40 ? { width: size, height: size } : undefined}>
      {children || <Icon name={icon} size={size >= 40 ? 18 : 16} />}
    </button>
  );
}

/* Action chip: a 36pt pill for this thread's next step (Open report, Stop, Changes so far). needs = answering a question. */
export function MoActionChip({ label, icon, tone = 'default', diff, onPress }) {
  return (
    <button type="button" className={'om-mo-chip om-mo-press' + (tone !== 'default' ? ' om-mo-chip--' + tone : '')} onClick={onPress}>
      {icon && <Icon name={icon} size={15} />}
      {label}
      {diff && <span className="om-mo-diff"><span className="add">+{diff[0]}</span> <span className="del">−{diff[1]}</span></span>}
    </button>
  );
}
