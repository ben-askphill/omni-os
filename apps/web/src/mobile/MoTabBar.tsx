import { Icon, StatusDot, type IconName } from '../components/ui.tsx';
import { useApp } from '../store.tsx';
import type { Tab } from './screens.ts';

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'activity', icon: 'inbox', label: 'Activity' },
  { id: 'channels', icon: 'hash', label: 'Channels' },
  { id: 'library', icon: 'layers', label: 'Library' },
];

/**
 * Three labelled tabs in a floating pill, the new-delegation disc beside it. The thumb springs between tabs, and a
 * needs glyph rides Activity while anything waits on Ben. Hidden on pushed screens.
 */
export function MoTabBar({ tab, onTab, onNew }: { tab: Tab; onTab: (t: Tab) => void; onNew: () => void }) {
  const { needsYou } = useApp();
  const needs = needsYou?.items.length ?? 0;
  const i = Math.max(0, TABS.findIndex((t) => t.id === tab));
  return (
    <div className="absolute right-3.5 left-3.5 z-20 flex gap-2.5" style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 20px) - 6px)' }}>
      <nav aria-label="Tabs" className="relative grid h-[60px] flex-1 grid-cols-3 rounded-full bg-elev p-1 shadow-[var(--shadow-menu)]">
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-1 rounded-full bg-surface-2"
          style={{ width: 'calc((100% - 8px) / 3)', transform: `translateX(${i * 100}%)`, transition: 'transform 420ms var(--ease-spring)' }}
        />
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            aria-current={t.id === tab ? 'page' : undefined}
            className={`relative z-[1] flex flex-col items-center justify-center gap-1 text-[11px] leading-none font-medium ${t.id === tab ? 'text-fg' : 'text-fg-3'}`}
          >
            <span className="relative grid">
              <Icon name={t.icon} size={20} />
              {t.id === 'activity' && needs > 0 && (
                <span className="absolute -top-[3px] -right-[7px] grid h-[13px] w-[13px] place-items-center rounded-full bg-elev" aria-label={`${needs} need you`} role="img">
                  <StatusDot status="needs" size={8} />
                </span>
              )}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
      <button
        type="button"
        aria-label="New delegation"
        onClick={onNew}
        className="mo-press grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-fg text-on-ink shadow-[var(--shadow-menu)]"
      >
        <Icon name="plus" size={22} />
      </button>
    </div>
  );
}
