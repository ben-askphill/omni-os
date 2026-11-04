import React from 'react';
import { StatusGlyph } from '../core/Status.jsx';
import { Icon } from '../icons/Icon.jsx';

export const MO_TABS = [
  { id: 'activity', icon: 'inbox', label: 'Activity' },
  { id: 'channels', icon: 'hash', label: 'Channels' },
  { id: 'library', icon: 'layers', label: 'Library' },
  { id: 'prs', icon: 'pr', label: 'PRs' }
];

/* Labelled tabs in a floating 60pt pill, the ink new-delegation disc beside it. The thumb springs between tabs
   (ease-spring, 420ms). A vermilion diamond rides Activity while anything needs you. Hidden on pushed screens. */
export function MoTabBar({ tabs = MO_TABS, value, onChange, needs = 0, onNew, placement = 'float' }) {
  const i = Math.max(0, tabs.findIndex((t) => t.id === value));
  return (
    <div className={'om-mo-tabbar' + (placement === 'static' ? ' om-mo-tabbar--static' : '')}>
      <nav aria-label="Tabs" style={{ gridTemplateColumns: `repeat(${tabs.length},minmax(0,1fr))` }}>
        <span aria-hidden="true" className="om-mo-tabbar__thumb" style={{ width: `calc((100% - 8px) / ${tabs.length})`, transform: `translateX(${i * 100}%)` }} />
        {tabs.map((t) => (
          <button key={t.id} type="button" className="om-mo-tabbar__tab" aria-current={t.id === value ? 'page' : undefined} onClick={() => onChange && onChange(t.id)}>
            <span className="om-mo-tabbar__icon">
              <Icon name={t.icon} size={20} />
              {t.id === 'activity' && needs > 0 && <span className="om-mo-tabbar__badge" role="img" aria-label={`${needs} need you`}><StatusGlyph state="needs" size={8} /></span>}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
      {onNew && <button type="button" className="om-mo-tabbar__new om-mo-press" aria-label="New delegation" onClick={onNew}><Icon name="plus" size={22} /></button>}
    </div>
  );
}
