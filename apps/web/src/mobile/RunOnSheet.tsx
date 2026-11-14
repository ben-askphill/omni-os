import { GROK_BOT, runOnPrefix, type RunOnRow } from '@omni/shared/thread-machine.ts';
import { Icon } from '../components/ui.tsx';
import { MoGroup, MoListRow, MoRadio, MoSection, MoSheet } from './parts.tsx';

/** The new-thread sheet's machine chip: "On Ben's MacBook Pro", "On omarchy" or "To Grok Bot". */
export function RunOnChip({ rows, value, onClick }: { rows: RunOnRow[]; value: string; onClick: () => void }) {
  const row = rows.find((r) => r.value === value);
  return (
    <button type="button" onClick={onClick} aria-label={`Run on: ${row?.label ?? 'none'}`} className="mo-press inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 self-start rounded-full bg-surface-2 pr-3 pl-2.5 text-[12.5px] font-medium text-fg">
      <Icon name={row?.icon ?? 'monitor'} size={13} className="shrink-0 text-fg-3" />
      <span className="shrink-0 text-fg-3">{runOnPrefix(value)}</span>
      <span className="truncate">{row?.label ?? 'Choose'}</span>
      <Icon name="chevronDown" size={12} className="shrink-0 text-fg-3" />
    </button>
  );
}

/**
 * Which machine a new thread runs on, as a sheet: the desktop RunOnPicker's rows, an offline machine greyed out. Grok
 * Bot, when the rows have it, gets its own section under the machines. Settings opens it too, for the default (`title`
 * and `note` say which).
 */
export function RunOnSheet({
  rows,
  value,
  onChange,
  onClose,
  title = 'Run on',
  note,
  accountFor,
}: {
  rows: RunOnRow[];
  value: string;
  onChange: (pick: string) => void;
  onClose: () => void;
  title?: string;
  note?: string;
  /** The account the picked harness runs as on a row's machine, first on its line. */
  accountFor?: (value: string) => string | null;
}) {
  const machines = rows.filter((r) => r.value !== GROK_BOT);
  const elsewhere = rows.filter((r) => r.value === GROK_BOT);
  return (
    <MoSheet full onClose={onClose} label={title}>
      <div className="flex shrink-0 items-center px-3 pt-1.5 pb-2">
        <span className="w-[60px]" />
        <span className="flex-1 text-center text-[15px] font-medium">{title}</span>
        <button type="button" onClick={onClose} className="w-[60px] px-1.5 py-2 text-right text-[15px] font-medium">
          Done
        </button>
      </div>
      <div className="mo-scroll flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto pb-3">
        <MoSection title="Machines">
          <RunOnRows rows={machines} value={value} onChange={onChange} onClose={onClose} accountFor={accountFor} />
          {note && <p className="m-0 px-4 pt-2 text-[12.5px] leading-[1.45] text-fg-3">{note}</p>}
        </MoSection>
        {elsewhere.length > 0 && (
          <MoSection title="Send instead">
            <RunOnRows rows={elsewhere} value={value} onChange={onChange} onClose={onClose} />
          </MoSection>
        )}
      </div>
    </MoSheet>
  );
}

function RunOnRows({
  rows,
  value,
  onChange,
  onClose,
  accountFor,
}: {
  rows: RunOnRow[];
  value: string;
  onChange: (pick: string) => void;
  onClose: () => void;
  accountFor?: (value: string) => string | null;
}) {
  return (
    <MoGroup>
      {rows.map((r, i) => (
        <MoListRow
          key={r.value}
          icon={r.icon ?? 'monitor'}
          label={r.label}
          sub={accountFor?.(r.value) ? `${accountFor(r.value)} · ${r.sub}` : r.sub}
          right={<MoRadio on={r.value === value} />}
          onClick={() => {
            onChange(r.value);
            onClose();
          }}
          disabled={r.disabled}
          chevron={false}
          last={i === rows.length - 1}
        />
      ))}
    </MoGroup>
  );
}
