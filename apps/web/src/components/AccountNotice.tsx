import { useState } from 'react';
import { accountNotices, switchLine, type AccountsView, type HarnessAccountView } from '@omni/shared/harness-accounts.ts';
import { acknowledgeSwitch, useAccounts } from '../accounts.ts';
import { errorText } from '../api.ts';
import { href } from '../router.ts';
import { harnessLabel } from './brand.tsx';
import { Icon } from './ui.tsx';

// A harness signed in as another account than before (apps/server/harness-accounts.ts), until someone acknowledges
// it here, in Settings > Accounts or on another client. Got it acknowledges it for every client and machine.

/** "Got it", with the list as the server answers it after. */
function useAcknowledge(onDone: (v: AccountsView) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ack = async (machine: string, harness: string) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await acknowledgeSwitch(machine, harness));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { ack, busy, error };
}

/**
 * Shown in the desktop sidebar, the rail's list panel and the phone's Activity screen, beside DiskNotice: the newest
 * switch on any machine, and how many more Settings > Accounts lists. Nothing while there is none.
 */
export function AccountNotice({ className = '' }: { className?: string }) {
  const { data, setData } = useAccounts();
  const { ack, busy, error } = useAcknowledge(setData);
  const notices = accountNotices(data);
  if (!notices.length) return null;
  const { machine, account } = notices[0];
  return (
    <div className={`rounded-[20px] bg-bg/70 px-3 py-2.5 shadow-[var(--shadow-card)] ${className}`} role="status">
      <div className="flex items-start gap-2">
        <span className="mt-px shrink-0 text-warn">
          <Icon name="user" size={14} />
        </span>
        <div className="min-w-0 flex-1 text-[12px] leading-[1.35]">
          <div className="break-words text-fg">{switchLine(machine.name, harnessLabel(account.harness), account)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" disabled={busy} onClick={() => void ack(machine.id, account.harness)} className="font-medium text-fg-2 hover:text-fg disabled:opacity-50">
              Got it
            </button>
            <a href={href.settingsSection('accounts')} className="text-fg-3 underline-offset-2 hover:underline">
              {notices.length > 1 ? `${notices.length - 1} more in Accounts` : 'All accounts'}
            </a>
          </div>
          {error && <div className="mt-1 text-needs">{error}</div>}
        </div>
      </div>
    </div>
  );
}

/** Under the new thread's composer: the harness it starts on switched accounts on the machine it runs on. */
export function ComposerAccountNotice({ machine, account, onSeen }: { machine: { id: string; name: string }; account: HarnessAccountView; onSeen: (v: AccountsView) => void }) {
  const { ack, busy, error } = useAcknowledge(onSeen);
  return (
    <div role="status" className="mx-2 mb-2 flex flex-wrap items-start gap-x-2 gap-y-1 rounded-2xl bg-surface-2 px-3 py-2 text-[12px]">
      <Icon name="user" size={13} className="mt-px shrink-0 text-warn" />
      <span className="min-w-0 flex-1 basis-48 break-words text-fg-2">{switchLine(machine.name, harnessLabel(account.harness), account)}</span>
      <button type="button" disabled={busy} onClick={() => void ack(machine.id, account.harness)} className="shrink-0 font-medium text-fg-2 hover:text-fg disabled:opacity-50">
        Got it
      </button>
      {error && <span className="basis-full text-needs">{error}</span>}
    </div>
  );
}
