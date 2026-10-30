import { href, startNewThread, useRoute } from '../../router.ts';
import { useApp } from '../../store.tsx';
import { Icon, IconButton, Kbd, Wordmark } from '../ui.tsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The rail's top: the wordmark with collapse-all (and the mobile drawer's close), then Search and New thread. */
export function SidebarTop({
  channelCount,
  foldAll,
  onToggleAll,
  onNavigate,
  onSearch,
  onClose,
}: {
  channelCount: number;
  foldAll: 'collapse' | 'expand';
  onToggleAll: () => void;
  onNavigate?: () => void;
  onSearch: () => void;
  onClose?: () => void;
}) {
  const route = useRoute();
  const { openThread } = useApp();
  return (
    <>
      <div className="flex h-14 items-center justify-between pr-3 pl-5">
        <a href={href.home()} onClick={onNavigate} aria-label="Omni home" className="wordmark-write">
          <Wordmark size={18} />
        </a>
        <div className={`flex items-center ${onClose ? '-mr-1' : ''}`}>
          {channelCount > 0 && (
            <button
              type="button"
              onClick={onToggleAll}
              aria-label={foldAll === 'collapse' ? 'Collapse all channels' : 'Expand all channels'}
              title={foldAll === 'collapse' ? 'Collapse all channels' : 'Expand all channels'}
              className={`hov grid shrink-0 place-items-center rounded-full text-fg-3 transition-colors hover:text-fg ${onClose ? 'h-11 w-11' : 'h-7 w-7'}`}
            >
              <Icon name={foldAll === 'collapse' ? 'foldAll' : 'unfoldAll'} size={onClose ? 17 : 15} />
            </button>
          )}
          {onClose && <IconButton icon="x" label="Close menu" onClick={onClose} className="h-11 w-11" />}
        </div>
      </div>

      <div className="space-y-2 px-3">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            onSearch();
          }}
          className="press flex h-10 w-full items-center gap-2.5 rounded-full bg-bg/70 pr-2 pl-3.5 text-[13px] text-fg-4 shadow-[var(--shadow-card)] transition-colors hover:text-fg-3"
        >
          <Icon name="search" size={15} />
          <span className="flex-1 text-left">Search or jump to</span>
          <Kbd className="bg-surface-2">{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
        </button>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            startNewThread(route, openThread);
          }}
          className="press flex h-10 w-full items-center justify-center gap-2 rounded-full bg-fg text-[13px] font-medium text-on-ink transition-colors hover:bg-fg/88"
        >
          <Icon name="plus" size={15} strokeWidth={2} /> New thread
        </button>
      </div>
    </>
  );
}
