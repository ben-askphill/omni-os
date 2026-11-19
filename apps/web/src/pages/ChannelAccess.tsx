// Channel settings' Access card: the channel's level, each connector's, and the tools "Always allow for <role>" let
// run here. The server enforces them (apps/server/access.ts, ADR 0015); this only shows and sets them.
import { useState } from 'react';
import { ACCESS_CONNECTORS, ACCESS_LEVELS, CONNECTOR_LEVELS, accessLabel, accessLevelOf, approvalTitle, type AccessLevel, type ConnectorAccess, type ConnectorLevel } from '@omni/shared/access.ts';
import { api, errorText, useApi } from '../api.ts';
import { Button, ErrorNote, Label, Picker, Segmented } from '../components/ui.tsx';

type Grant = { role: string; name?: string; tools: string[] };
const FOLLOW = 'follow';

export function AccessCard({
  channelId,
  level,
  set,
  machineDefault,
  connectors,
  onLevel,
  onConnectors,
}: {
  channelId?: string;
  level: AccessLevel;
  /** False while the channel has no level of its own and runs at the machine's default. */
  set: boolean;
  machineDefault?: string;
  connectors: ConnectorAccess;
  onLevel: (l: AccessLevel) => void;
  onConnectors: (c: ConnectorAccess) => void;
}) {
  const chosen = ACCESS_LEVELS.find((l) => l.id === level)!;
  const fallback = accessLabel(accessLevelOf(machineDefault));
  const connectorOptions = [
    { value: FOLLOW, label: 'Same as channel', sub: `Follows the channel: ${accessLabel(level)}`, avatar: false as const },
    ...CONNECTOR_LEVELS.map((l) => ({ value: l.id, label: l.label, sub: l.description, avatar: false as const })),
  ];
  return (
    <div className="space-y-4">
      <div>
        <Label hint={set ? chosen.description : `Not set, so it runs at this computer’s default: ${fallback}. ${chosen.description}`}>What agents may do</Label>
        <Segmented label="Access level" value={level} onChange={onLevel} options={ACCESS_LEVELS.map((l) => ({ id: l.id, label: l.label }))} />
      </div>
      <div>
        <Label hint="An account or the browser can have its own level. A crew role whose file sets a stricter one runs at that.">Connectors</Label>
        <div className="divide-y divide-line rounded-[18px] bg-surface-2">
          {ACCESS_CONNECTORS.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="text-[13px] text-fg">{c.label}</span>
              <Picker
                label={`${c.label} access`}
                value={connectors[c.id] ?? FOLLOW}
                options={connectorOptions}
                align="right"
                onChange={(v) => {
                  const next = { ...connectors };
                  if (v === FOLLOW) delete next[c.id];
                  else next[c.id] = v as ConnectorLevel;
                  onConnectors(next);
                }}
              />
            </div>
          ))}
        </div>
      </div>
      {channelId && <RoleGrants channelId={channelId} />}
    </div>
  );
}

/** What "Always allow for <role>" let run in this channel. Removing one takes effect on the role's next call. */
function RoleGrants({ channelId }: { channelId: string }) {
  const url = `/channels/${encodeURIComponent(channelId)}/access-grants`;
  const { data, reload } = useApi<{ grants: Grant[] }>(url);
  const [error, setError] = useState<string | null>(null);
  const grants = data?.grants ?? [];
  if (!grants.length) return null;
  const remove = async (role: string, tool?: string) => {
    setError(null);
    try {
      await api.del(`${url}/${encodeURIComponent(role)}${tool ? `?tool=${encodeURIComponent(tool)}` : ''}`);
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <div>
      <Label hint="Tools a crew role runs here without asking, because you chose Always allow on its card.">Always allowed</Label>
      <div className="space-y-2">
        {grants.map((g) => (
          <div key={g.role} className="rounded-[18px] bg-surface-2 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-fg">{g.name || g.role}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => void remove(g.role)}>
                Remove all
              </Button>
            </div>
            <ul className="mt-1 space-y-1">
              {g.tools.map((t) => (
                <li key={t} className="flex items-center justify-between gap-3 text-[12.5px] text-fg-2">
                  <span className="min-w-0 truncate">{approvalTitle({ tool: t })}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void remove(g.role, t)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
