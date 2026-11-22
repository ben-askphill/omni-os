import { useEffect, useId, useMemo, useState } from 'react';
import { Checkbox, CheckboxIndicator } from '@ui-sdk/react/checkbox';
import { skillMeta, skillRows, skillsHarnessNote, toggleSkill, SKILL_HARNESS_NAMES, type SkillCatalog, type SkillHarness, type SkillRow } from '@omni/shared/agent-skills.ts';
import { harnessName } from '@omni/shared/composer-slash.ts';
import { useApi } from '../api.ts';
import { ErrorNote, Icon, Loading, SearchField, StatusDot } from './ui.tsx';

// An agent's Skills group in Settings > Agents: every skill this machine's harnesses list (GET /api/skills), searchable,
// each with a box to tick it. A ticked skill loads at the start of every thread the agent runs
// (apps/server/skills.ts). The ticked ones lead the list, and one the machine no longer has stays there to untick.

/** "Claude Code, Codex and Cursor Agent". */
const names = (hs: readonly SkillHarness[]) => {
  const all = hs.map((h) => SKILL_HARNESS_NAMES[h]);
  return all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all.at(-1)}` : (all[0] ?? '');
};

/** While a harness is still reading its first list, ask again after this long. */
const RELOAD_MS = 2500;

export function AgentSkills({ value, onChange, channel, harness }: {
  value: string[];
  onChange: (next: string[]) => void;
  /** The agent's default channel, whose repo's project skills the list adds. */
  channel?: string;
  /** The agent's default harness, when it names one. */
  harness?: string;
}) {
  const catalog = useApi<SkillCatalog>(`/skills${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`);
  const [query, setQuery] = useState('');
  const reload = catalog.reload;
  // A server from before skills answers this path with something else: read it as an empty list.
  const loading = catalog.data?.loading ?? [];
  useEffect(() => {
    if (!loading.length) return;
    const t = setTimeout(reload, RELOAD_MS);
    return () => clearTimeout(t);
  }, [loading.length, reload]);

  const rows = useMemo(() => skillRows(catalog.data, value, query), [catalog.data, value, query]);
  const note = skillsHarnessNote(harness, harnessName);
  const listed = catalog.data?.listed ?? [];
  const total = catalog.data?.skills?.length ?? 0;

  return (
    <div className="space-y-3">
      {note && (
        <p className="text-[12.5px] leading-[18px] text-fg-2" data-skills-note>
          {note}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SearchField value={query} onChange={setQuery} placeholder="Search skills" label="Search skills" />
        <span className="text-[12.5px] text-fg-3" role="status">
          {value.length ? `${value.length} ticked` : 'None ticked'}
          {total > 0 && ` of ${total}`}
        </span>
      </div>
      {catalog.error ? (
        <ErrorNote onRetry={reload}>{catalog.error}</ErrorNote>
      ) : !catalog.data ? (
        <Loading />
      ) : (
        <div className="-mx-1 max-h-[22rem] overflow-y-auto overscroll-contain px-1" data-skill-list>
          {rows.length ? (
            <ul className="divide-y divide-line" aria-label="Skills">
              {rows.map((row) => (
                <SkillItem key={row.name} row={row} listed={listed} onToggle={() => onChange(toggleSkill(value, row.name))} />
              ))}
            </ul>
          ) : (
            <p className="py-3 text-[12.5px] text-fg-3">{total ? `No skill matches "${query.trim()}".` : 'No harness on this machine lists a skill yet.'}</p>
          )}
        </div>
      )}
      <p className="text-[12.5px] text-fg-3">
        From {listed.length ? names(listed) : 'the harnesses'} on this machine
        {loading.length > 0 && `, still reading ${names(loading)}`}. Hermes, Cursor Cloud and remote agents run elsewhere and load none. A project skill loads only in a repo that has it.
      </p>
    </div>
  );
}

function SkillItem({ row, listed, onToggle }: { row: SkillRow; listed: SkillCatalog['listed']; onToggle: () => void }) {
  const id = useId();
  const meta = row.entry ? skillMeta(row.entry, listed) : '';
  return (
    <li className="[content-visibility:auto] [contain-intrinsic-size:auto_52px]">
      {/* The whole row toggles, but the box is named by the skill alone: a wrapping label would name it by every line. */}
      <label className="flex cursor-pointer items-start gap-3 py-2.5">
        <Checkbox
          checked={row.picked}
          onCheckedChange={onToggle}
          aria-labelledby={`${id}-name`}
          aria-describedby={`${id}-meta ${id}-about`}
          className="focus-ring mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] text-on-ink shadow-[inset_0_0_0_1.5px_var(--line-strong)] data-checked:bg-fg data-checked:shadow-none"
        >
          <CheckboxIndicator>
            <Icon name="check" size={12} strokeWidth={2.6} />
          </CheckboxIndicator>
        </Checkbox>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span id={`${id}-name`} className="min-w-0 truncate font-mono text-[12.5px] text-fg">
              {row.name}
            </span>
            <span id={`${id}-meta`} className="text-[12px] text-fg-3">
              {meta}
            </span>
          </span>
          <span id={`${id}-about`} className="mt-0.5 line-clamp-2 text-[12.5px] leading-[18px] text-fg-3">
            {row.entry ? (
              row.entry.description || 'No description.'
            ) : (
              <span className="inline-flex items-center gap-1.5 text-fg-2">
                <StatusDot status="needs" size={8} />
                Not on this machine, so its threads skip it. Untick it, or install it here.
              </span>
            )}
          </span>
        </span>
      </label>
    </li>
  );
}
