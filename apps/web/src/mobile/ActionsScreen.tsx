// The channel's named actions, run in this thread's checkout: the desktop panel's Actions tab on its own screen.
import { ActionsTab } from '../components/thread/panel/ActionsTab.tsx';
import { MoEmpty, MoHeader } from './parts.tsx';
import { useShell, useThread } from './shell.tsx';

export function ActionsScreen() {
  const shell = useShell();
  const { thread } = useThread();
  return (
    <>
      <MoHeader onBack={shell.back} title="Actions" sub="Runs in this thread's checkout" />
      <div className="flex min-h-0 flex-1 flex-col pt-1" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
        {thread ? <ActionsTab thread={thread} /> : <MoEmpty>Loading</MoEmpty>}
      </div>
    </>
  );
}
