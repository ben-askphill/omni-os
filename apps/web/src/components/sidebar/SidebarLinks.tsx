import type { ReactNode } from 'react';
import { href, useRoute } from '../../router.ts';
import { NavLink } from './SidebarRows.tsx';

/** The rail's Workspace group: Artifacts, Automations and Settings. */
export function WorkspaceLinks({ onNavigate }: { onNavigate?: () => void }) {
  const route = useRoute();
  return (
    <div>
      <div className="caption px-3 pt-1 pb-2">Workspace</div>
      <div className="space-y-px">
        <NavLink to={href.artifacts()} icon="layers" active={route.name === 'artifacts'} onNavigate={onNavigate}>
          Artifacts
        </NavLink>
        <NavLink to={href.automations()} icon="zap" active={route.name === 'automations'} onNavigate={onNavigate}>
          Automations
        </NavLink>
        <NavLink to={href.settingsPage()} icon="sliders" active={route.name === 'settings'} onNavigate={onNavigate}>
          Settings
        </NavLink>
      </div>
    </div>
  );
}

/** The link under a channel's threads to its full list: "See all threads", or "N more". */
export function ChannelListLink({ channelId, onNavigate, children }: { channelId: string; onNavigate?: () => void; children: ReactNode }) {
  return (
    <a href={href.channel(channelId)} onClick={onNavigate} className="hov z-[1] ml-[25px] flex h-7 items-center rounded-full pr-3 pl-8 text-[12px] text-fg-4 transition-colors hover:text-fg-2">
      {children}
    </a>
  );
}
