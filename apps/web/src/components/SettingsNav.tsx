import { useState } from 'react';
import { searchSettings, sectionDef, sectionsIn, SETTINGS_GROUPS, type SettingsSectionId } from '@omni/shared/settings-catalog.ts';
import { desktop } from '../desktop.ts';
import { href, navigate } from '../router.ts';
import { Icon, type IconName } from './ui.tsx';

// Settings' nav on a desktop: a search box over the groups of sections (@omni/shared/settings-catalog.ts), the same
// groups and order as the phone's Settings screen and the Mac app's Settings sidebar. Typing lists the settings that
// match instead; picking one opens its section and scrolls to it. Links, so a section has a hash of its own.

export function SettingsNav({ section }: { section: SettingsSectionId }) {
  const [q, setQ] = useState('');
  const hits = searchSettings(q, desktop ? 'desktop' : 'web', { loginItem: desktop?.loginItemSupported });
  const open = (s: SettingsSectionId, focus?: string) => {
    setQ('');
    navigate(href.settingsSection(s, focus));
  };
  return (
    <nav aria-label="Settings sections" className="space-y-4">
      <label className="flex h-9 items-center gap-2 rounded-full bg-surface px-3 text-fg-3 focus-within:shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) open(hits[0].section, hits[0].id);
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
            {g.title && <div className="caption mb-1 px-3">{g.title}</div>}
            <ul className="space-y-0.5">
              {sectionsIn(g.id, { desktopApp: desktop !== null }).map((d) => {
                const current = d.id === section;
                return (
                  <li key={d.id}>
                    <a
                      href={href.settingsSection(d.id as SettingsSectionId)}
                      aria-current={current ? 'page' : undefined}
                      className={`flex h-8 items-center gap-2.5 rounded-[12px] px-3 text-[13px] ${current ? 'bg-surface-2 text-fg' : 'text-fg-2 hover:bg-surface hover:text-fg'}`}
                    >
                      <Icon name={d.icon as IconName} size={15} className={current ? 'text-fg' : 'text-fg-3'} />
                      <span className="truncate">{d.title}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </nav>
  );
}
