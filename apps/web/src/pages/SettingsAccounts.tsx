import { useState } from 'react';
import { relTime } from '@omni/shared/format.ts';
import {
  accountDetail,
  accountLine,
  accountNotices,
  accountTone,
  switchLine,
  type AccountsView,
  type HarnessAccountView,
  type MachineAccounts,
} from '@omni/shared/harness-accounts.ts';
import { acknowledgeSwitch, useAccounts } from '../accounts.ts';
import { api, errorText } from '../api.ts';
import { HarnessMark, harnessLabel } from '../components/brand.tsx';
import { Button, Chip, ErrorNote, Icon, Loading, StatusDot } from '../components/ui.tsx';
import { href } from '../router.ts';
import { useNow } from '../store.tsx';
import { Card } from './settings-parts.tsx';

// Settings, Accounts: every machine, every harness, and the account it runs as (GET /api/accounts). Each machine
// reads its own and syncs it, so a row for another machine is as that machine last reported it. A switch shows at the
// top until someone acknowledges it, on any client.

export function AccountsSection() {
  const res = useAccounts();
  const { data, setData } = res;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(60_000);

  const run = async (key: string, fn: () => Promise<AccountsView>) => {
    setBusy(key);
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const notices = accountNotices(data);
  return (
    <Card
      entry="harness-accounts"
      title="Signed in on each machine"
      subtitle="Each machine checks its own harnesses and syncs the result. A thread bills the account of the machine it runs on."
      actions={
        <Button size="sm" variant="ghost" icon="refresh" busy={busy === 'refresh'} disabled={!!busy} onClick={() => void run('refresh', () => api.get<AccountsView>('/accounts?refresh=1'))}>
          Check again
        </Button>
      }
    >
      {res.error && <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data ? (
        !res.error && <Loading />
      ) : (
        <div className="space-y-4">
          {notices.length > 0 && (
            <ul className="space-y-2" aria-label="Account switches">
              {notices.map(({ machine, account }) => (
                <li key={`${machine.id}:${account.harness}`} role="status" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl bg-surface-2 px-3 py-2.5">
                  <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-warn" />
                  <div className="min-w-0 flex-1 basis-56 text-[12.5px]">
                    <div className="break-words text-fg">{switchLine(machine.name, harnessLabel(account.harness), account)}</div>
                    {account.switched && <div className="text-fg-3">Switched {relTime(account.switched.at, now)}</div>}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    busy={busy === `${machine.id}:${account.harness}`}
                    disabled={!!busy}
                    onClick={() => void run(`${machine.id}:${account.harness}`, () => acknowledgeSwitch(machine.id, account.harness))}
                  >
                    Got it
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {data.machines.map((m) => (
            <MachineBlock key={m.id} m={m} now={now} />
          ))}
          {!data.synced && (
            <p className="text-[12.5px] text-fg-3">
              Only this machine is listed. Sync your other machines with this one and each lists its own accounts here. Set that up in{' '}
              <a className="underline underline-offset-2" href={href.settingsSection('sync')}>
                Sync
              </a>
              .
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function MachineBlock({ m, now }: { m: MachineAccounts; now: number }) {
  return (
    <section aria-label={m.name}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-1">
        <Icon name="monitor" size={14} className="shrink-0 text-fg-3" />
        <h3 className="min-w-0 truncate text-[13px] font-medium">{m.name}</h3>
        {m.current && <Chip>This machine</Chip>}
        <span className="ml-auto shrink-0 text-[12px] text-fg-3">{m.checkedAt ? `Checked ${relTime(m.checkedAt, now)}` : 'Not checked yet'}</span>
      </div>
      <ul className="divide-y divide-line">
        {m.accounts.map((a) => (
          <AccountRow key={a.harness} a={a} />
        ))}
      </ul>
    </section>
  );
}

function AccountRow({ a }: { a: HarnessAccountView }) {
  const detail = accountDetail(a);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-[13px]">
      <span className="w-[150px] shrink-0 max-sm:w-full">
        <HarnessMark harness={a.harness} withLabel />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={a.notice ? 'needs' : accountTone(a)} size={7} />
          <span className={`min-w-0 truncate ${a.state === 'signed-in' ? 'text-fg' : 'text-fg-2'}`} title={accountLine(a)}>
            {accountLine(a)}
          </span>
        </div>
        {detail && <div className="mt-0.5 break-words pl-[15px] text-[12px] text-fg-3">{detail}</div>}
      </div>
    </li>
  );
}
