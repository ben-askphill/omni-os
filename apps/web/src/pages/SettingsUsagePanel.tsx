import { useId, useMemo, useState } from 'react';
import { DEFAULT_USAGE_PANEL, entryDetail, isDefaultUsagePanel, withOrder, withShown, type PanelEntry, type UsagePanelPrefs } from '@omni/shared/usage-panel.ts';
import { errorText } from '../api.ts';
import { HarnessMark, harnessLabel } from '../components/brand.tsx';
import { usePanelEntries } from '../components/sidebar/UsageCard.tsx';
import { SortableHandle, SortableItem, SortableList } from '../components/ui/sortable-list-parts.tsx';
import { Button, ErrorNote, Icon, Toggle } from '../components/ui.tsx';
import { saveUsagePanel, useUsagePanel } from '../usage-panel.ts';
import { Card } from './settings-parts.tsx';

// Settings > Usage panel: every account and harness the Usage panel can show, in its order, each with a switch. The
// server keeps the choice (GET /api/usage-panel) and syncs it, so every device and machine shows the same panel.

const nameOf = (e: PanelEntry) => (e.account ? `${harnessLabel(e.harness)}, ${e.account.label}` : harnessLabel(e.harness));

export function UsagePanelSection() {
  const prefs = useUsagePanel();
  const entries = usePanelEntries();
  const [error, setError] = useState<string | null>(null);
  const hint = useId();
  const keys = useMemo(() => entries.map((e) => e.key), [entries]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const save = (next: UsagePanelPrefs) => {
    setError(null);
    saveUsagePanel(next).catch((e: unknown) => setError(errorText(e)));
  };

  return (
    <Card
      entry="usage-panel"
      title="Rows and order"
      subtitle="The Usage panel shows these top to bottom, on every device and machine. An account that signs in later joins at the end."
      actions={
        !isDefaultUsagePanel(prefs) && (
          <Button size="sm" variant="ghost" onClick={() => save(DEFAULT_USAGE_PANEL)}>
            Reset
          </Button>
        )
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <SortableList
        value={keys}
        onValueChange={(order) => save(withOrder(prefs, order))}
        itemLabel={(key) => {
          const e = byKey.get(key);
          return e && nameOf(e);
        }}
        aria-label="Usage panel rows"
        className="divide-y divide-line"
        data-testid="usage-panel-list"
      >
        {({ order }) =>
          order.map((key) => {
            const e = byKey.get(key);
            if (!e) return null;
            const name = nameOf(e);
            return (
              <SortableItem key={key} value={key} className="flex items-center gap-2 rounded-xl bg-surface py-2 pr-1" data-testid="usage-panel-row">
                <SortableHandle value={key} aria-label={`Move ${name}`} aria-describedby={hint} className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-fg-3 hover:text-fg aria-pressed:bg-surface-2 aria-pressed:text-fg">
                  <Icon name="grip" size={16} />
                </SortableHandle>
                <div className="min-w-0 flex-1">
                  <HarnessMark harness={e.harness} withLabel />
                  <div className={`mt-0.5 truncate pl-[26px] text-[12px] ${e.shown ? 'text-fg-2' : 'text-fg-3'}`} title={entryDetail(e)}>
                    {entryDetail(e)}
                  </div>
                </div>
                <Toggle checked={e.shown} onChange={(shown) => save(withShown(prefs, entries, key, shown))} label={`Show ${name}`} />
              </SortableItem>
            );
          })
        }
      </SortableList>
      <p id={hint} className="text-[12.5px] text-fg-3">
        Drag a row by its handle. With the keyboard, focus a handle, press Space, move it with the arrow keys and press Space again.
      </p>
    </Card>
  );
}
