// Each phone screen's component, by the key screens.ts gives its route, and the shell's sheets.
import type { ReactNode } from 'react';
import type { Route } from '../router.ts';
import { MoHeader, MoScroll, MoTitle } from './parts.tsx';
import type { ScreenKey } from './screens.ts';
import { useShell, type ShellSheet } from './shell.tsx';

function Placeholder({ title, root }: { title: string; root?: boolean }) {
  const shell = useShell();
  return (
    <>
      <MoHeader onBack={root ? undefined : shell.back} title={root ? undefined : title} left={root ? <span className="w-10" /> : undefined} />
      <MoScroll tabBar={root}>{root && <MoTitle title={title} />}</MoScroll>
    </>
  );
}

export const RENDER: Record<ScreenKey, (r: Route) => ReactNode> = {
  activity: () => <Placeholder title="Activity" root />,
  channels: () => <Placeholder title="Channels" root />,
  library: () => <Placeholder title="Library" root />,
  channel: () => <Placeholder title="Channel" />,
  'channel-pr': () => <Placeholder title="Pull request" />,
  thread: () => <Placeholder title="Thread" />,
  steps: () => <Placeholder title="Steps" />,
  changes: () => <Placeholder title="Changes" />,
  pr: () => <Placeholder title="Pull request" />,
  browser: () => <Placeholder title="Browser" />,
  terminal: () => <Placeholder title="Terminal" />,
  details: () => <Placeholder title="Details" />,
  viewer: () => <Placeholder title="Viewer" />,
  settings: () => <Placeholder title="Settings" />,
  search: () => <Placeholder title="Search" />,
  page: () => <Placeholder title="Page" />,
  notfound: () => <Placeholder title="Not found" />,
};

export function SheetView({ sheet }: { sheet: ShellSheet }) {
  void sheet;
  return null;
}
