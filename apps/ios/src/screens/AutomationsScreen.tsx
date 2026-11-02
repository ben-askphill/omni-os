import type { Automation, OmniApi } from '@omni/client-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Switch } from 'react-native';

import { useLiveHub } from '../live/react';
import { useRemote } from '../live/use-remote';
import { RemoteList } from '../settings/RemoteList';
import { automationRows, withEnabled } from '../settings/automations-model';
import { GroupedList, ListRow } from '../ui/GroupedList';

const loadAutomations = (api: OmniApi) => api.automations();

/** Settings, Automations: what runs on a schedule or an event, with a switch to pause or resume each. Read only otherwise, as on the phone web. */
export function AutomationsScreen() {
  const hub = useLiveHub();
  const remote = useRemote(loadAutomations);
  const { data, setData } = remote;
  const latest = useRef<Automation[] | null>(null);
  useEffect(() => {
    latest.current = data;
  }, [data]);
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => automationRows(data ?? [], Date.now()), [data]);

  function track(id: string, on: boolean) {
    if (on) inFlight.current.add(id);
    else inFlight.current.delete(id);
    setPending(new Set(inFlight.current));
  }

  async function toggle(id: string, enabled: boolean) {
    const list = latest.current;
    const before = list?.find((a) => a.id === id)?.enabled;
    if (!list || before === undefined || inFlight.current.has(id)) return;
    track(id, true);
    setData(withEnabled(list, id, enabled));
    try {
      await hub.request((api) => api.setAutomationEnabled(id, enabled));
    } catch (e) {
      if (latest.current) setData(withEnabled(latest.current, id, before));
      Alert.alert("Couldn't update automation", e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      track(id, false);
    }
  }

  return (
    <RemoteList
      remote={remote}
      what="automations"
      emptyTitle="No automations"
      emptyHint="Add a YAML file to automations/ on the server and it shows up here."
    >
      <GroupedList>
        {rows.map((row, i) => (
          <ListRow
            key={row.id}
            first={i === 0}
            title={row.name}
            detail={row.detail}
            trailing={
              <Switch
                accessibilityLabel={row.switchLabel}
                value={row.enabled}
                disabled={row.invalid || pending.has(row.id)}
                onValueChange={(next) => void toggle(row.id, next)}
                hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
              />
            }
          />
        ))}
      </GroupedList>
    </RemoteList>
  );
}
