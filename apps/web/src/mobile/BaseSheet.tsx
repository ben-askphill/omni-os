import { Icon } from '../components/ui.tsx';
import type { BasePick } from '@omni/shared/worktree-base.ts';
import { pickKey, type BaseOption } from '../worktree-base.ts';
import { MoGroup, MoListRow, MoRadio, MoSection, MoSheet } from './parts.tsx';

/** The new-thread sheet's base chip: "From main · a1b2c3d". */
export function BaseChip({ rows, value, onClick }: { rows: BaseOption[]; value: BasePick; onClick: () => void }) {
  const row = rows.find((r) => r.key === pickKey(value));
  return (
    <button type="button" onClick={onClick} aria-label={`Base: ${row?.label ?? 'none'}`} className="mo-press inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 self-start rounded-full bg-surface-2 pr-3 pl-2.5 text-[12.5px] font-medium text-fg">
      <Icon name="branch" size={13} className="shrink-0 text-fg-3" />
      <span className="shrink-0 text-fg-4">From</span>
      <span className="truncate">{row?.label ?? 'Choose'}</span>
      <Icon name="chevronDown" size={12} className="shrink-0 text-fg-4" />
    </button>
  );
}

/** Where a new worktree thread's branch starts, as a sheet: the desktop BasePicker's rows, grouped by what they are. */
export function BaseSheet({ rows, value, onChange, onClose }: { rows: BaseOption[]; value: BasePick; onChange: (pick: BasePick) => void; onClose: () => void }) {
  const on = pickKey(value);
  const groups = [
    { title: 'Start from', rows: rows.filter((r) => r.kind === 'head' || r.kind === 'remote') },
    { title: 'Branches', rows: rows.filter((r) => r.kind === 'branch') },
    { title: 'Tags', rows: rows.filter((r) => r.kind === 'tag') },
  ].filter((g) => g.rows.length);
  return (
    <MoSheet full onClose={onClose} label="Base of the new thread">
      <div className="flex shrink-0 items-center px-3 pt-1.5 pb-2">
        <span className="w-[60px]" />
        <span className="flex-1 text-center text-[15px] font-medium">Base</span>
        <button type="button" onClick={onClose} className="w-[60px] px-1.5 py-2 text-right text-[15px] font-medium">
          Done
        </button>
      </div>
      <div className="mo-scroll flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto pb-3">
        {groups.map((g) => (
          <MoSection key={g.title} title={g.title}>
            <MoGroup>
              {g.rows.map((r, i) => (
                <MoListRow
                  key={r.key}
                  icon="branch"
                  label={r.label}
                  sub={r.sub}
                  right={<MoRadio on={r.key === on} />}
                  onClick={() => {
                    onChange(r.pick);
                    onClose();
                  }}
                  chevron={false}
                  last={i === g.rows.length - 1}
                />
              ))}
            </MoGroup>
          </MoSection>
        ))}
      </div>
    </MoSheet>
  );
}
