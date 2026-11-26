import { useState } from 'react';
import { searchSettings, sectionDef, sectionsIn, SETTINGS_GROUPS, type SettingsSectionId } from '@omni/shared/settings-catalog.ts';
import { desktop } from '../desktop.ts';
import { href, navigate } from '../router.ts';
import { Icon, type IconName } from './ui.tsx';
import { isImeEnter } from '../ime.ts';
import { useTooltip } from './ui/tooltip.tsx';
import { RowCard } from './rail/RowCard.tsx';

// Settings' nav on a desktop: a search box over the groups of sections (@omni/shared/settings-catalog.ts), the same
// groups and order as the phone's Settings screen. Typing lists the settings that
// match instead; picking one opens its section and scrolls to it. Links, so a section has a hash of its own.

/**
 * `compact`: the rail's list panel, 30px rows. `collapsed` (with it): the Collapsed list, each section's icon alone with
 * its name in the card shown on hover and focus, and no search box, which has no room.
 */
export function SettingsNav({ section, compact = false, collapsed = false }: { section: SettingsSectionId; compact?: boolean; collapsed?: boolean }) {
  const [q, setQ] = useState('');
  const hits = searchSettings(q, desktop ? 'desktop' : 'web', { loginItem: desktop?.loginItemSupported });
  const open = (s: SettingsSectionId, focus?: string) => {
    setQ('');
    navigate(href.settingsSection(s, focus));
  };
  return (
    <nav aria-label="Settings sections" className={compact ? 'space-y-2' : 'space-y-4'}>
      <label className={`items-center gap-2 rounded-full bg-surface px-3 text-fg-3 focus-ring-within focus-within:shadow-[inset_0_0_0_1px_var(--line-strong)] ${collapsed ? 'hidden' : 'flex'} ${compact ? 'h-[30px]' : 'h-9'}`}>
        <Icon name="search" size={14} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isImeEnter(e) && hits[0]) open(hits[0].section, hits[0].id);
            if (e.key === 'Escape') setQ('');
          }}
          placeholder="Search settings"
          aria-label="Search settings"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3"
        />
      </label>
      {q.trim() ? (
        <ul className="space-y-0.5" aria-label="Matching settings">
          {hits.length === 0 && <li className="px-3 py-2 text-[12.5px] text-fg-3">No setting matches.</li>}
          {hits.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => open(e.section, e.id)} className="w-full rounded-[12px] px-3 py-1.5 text-left hover:bg-surface">
                <div className="text-[13px]">{e.title}</div>
                <div className="text-[11.5px] text-fg-3">{sectionDef(e.section).title}</div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        SETTINGS_GROUPS.map((g) => (
          <div key={g.id}>
            {g.title && !collapsed && <div className={`caption px-3 ${compact ? 'crow-cap mb-0 !px-2.5' : 'mb-1'}`}>{g.title}</div>}
            {g.title && collapsed && <div aria-hidden className="crow-cap"><span className="block h-px w-4 bg-line-strong" /></div>}
            <ul className="space-y-0.5">
              {sectionsIn(g.id, { desktopApp: desktop !== null }).map((d) => (
                <SectionLink key={d.id} d={d} current={d.id === section} compact={compact} />
              ))}
            </ul>
          </div>
        ))
      )}
    </nav>
  );
}

function SectionLink({ d, current, compact }: { d: ReturnType<typeof sectionsIn>[number]; current: boolean; compact: boolean }) {
  const card = useTooltip(compact ? <RowCard title={d.title} lines={[d.blurb]} /> : null, { side: 'right', variant: 'card' });
  return (
    <li>
      <a
        {...card.triggerProps}
        href={href.settingsSection(d.id as SettingsSectionId)}
        aria-current={current ? 'page' : undefined}
        aria-label={compact ? d.title : undefined}
        className={`flex items-center text-[13px] ${compact ? 'crow rounded-[9px] !font-normal' : 'h-8 gap-2.5 rounded-[12px] px-3'} ${current ? 'bg-surface-2 text-fg' : 'text-fg-2 hover:bg-surface hover:text-fg'}`}
      >
        {/* A fixed slot, so every label starts on one line whatever its icon draws. */}
        <span className="grid w-4 shrink-0 place-items-center">
          <Icon name={d.icon as IconName} size={compact ? 14 : 15} className={current ? 'text-fg' : 'text-fg-3'} />
        </span>
        <span className={`truncate ${compact ? 'crow-x' : ''}`}>{d.title}</span>
      </a>
      {card.tip}
    </li>
  );
}
