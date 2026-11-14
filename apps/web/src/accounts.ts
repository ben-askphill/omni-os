import { useEffect } from 'react';
import { accountsByHarness, machineAccounts, type AccountsView, type HarnessAccountView, type ThreadAccount } from '@omni/shared/harness-accounts.ts';
import { api, useApi } from './api.ts';
import { useFeed } from './store.tsx';

// Which account each harness runs as, per machine (GET /api/accounts, apps/server/harness-accounts.ts). Fresh on every
// `accounts` and reconnect message: a switch here, another machine's record or an acknowledgement synced in.

export function useAccounts() {
  const res = useApi<AccountsView>('/accounts');
  useFeed((e) => {
    if (e.type === 'accounts' || e.type === 'reconnect') res.reload();
  });
  return res;
}

/** Acknowledge the switch shown for a harness on a machine. Answers with the list as it now stands. */
export const acknowledgeSwitch = (machine: string, harness: string) => api.post<AccountsView>('/accounts/seen', { machine, harness });

/** What the pickers need: one machine's accounts by harness, and its name. `pick` is a Run on pick ("here" or a machine id). */
export interface PickerAccounts {
  id: string;
  machine: string;
  current: boolean;
  byHarness: Record<string, HarnessAccountView>;
}

export function pickerAccounts(view: AccountsView | undefined, pick: string | null | undefined): PickerAccounts | null {
  const m = machineAccounts(view, pick);
  return m ? { id: m.id, machine: m.name, current: m.current, byHarness: accountsByHarness(m) } : null;
}

/** The account a thread last ran as, read again whenever its status moves (a new process stamps it). */
export function useThreadAccount(threadId: string, status: string | undefined): ThreadAccount | null {
  const res = useApi<{ account: ThreadAccount | null }>(`/accounts/threads/${encodeURIComponent(threadId)}`);
  const { reload } = res;
  useEffect(() => {
    if (status === 'running' || status === 'done' || status === 'failed') reload();
  }, [status, reload]);
  return res.data?.account ?? null;
}
