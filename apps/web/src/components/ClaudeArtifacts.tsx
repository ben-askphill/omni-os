import { useEffect, useMemo, useState } from 'react';
import {
  CLAUDE_ARTIFACT_SCOPES,
  CLAUDE_ARTIFACTS_SCHEDULES,
  ERROR_TEXT,
  filterClaudeArtifacts,
  freshness,
  GALLERY_URL,
  typeLabel,
  typesIn,
  updatedLabel,
  type ClaudeArtifact,
  type ClaudeArtifactScopeFilter,
  type ClaudeArtifactsResponse,
  type ClaudeArtifactsSchedule,
  type ClaudeArtifactsState,
} from '@omni/shared/claude-artifacts.ts';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi } from '../api.ts';
import { href } from '../router.ts';
import { useFeed, useNow } from '../store.tsx';
import { Loader } from './brand.tsx';
import { Button, Empty, ErrorNote, Icon, Loading, Picker, Segmented, type IconName } from './ui.tsx';

// Ben's claude.ai Artifacts (apps/server/claude-artifacts.ts): the list on the Artifacts page's claude.ai switch and the
// phone Library's. Opening a row leaves Omni: a new tab in a browser, the system browser in the desktop app
// (windows.ts hands a new-window link to shell.openExternal), Safari or the Claude app on a phone.

const TYPE_ICON: Record<string, IconName> = {
  page: 'file',
  slides: 'square',
  docs: 'type',
  design: 'pencil',
  dashboard: 'gauge',
  motion: 'play',
  'design-system': 'grid',
};
const typeIcon = (type: string | null): IconName => (type ? (TYPE_ICON[type] ?? 'globe') : 'globe');

/** The list, its run state, and the calls that change them. Opening asks for a refresh, which the server skips when its last try is under ten minutes old. */
export function useClaudeArtifacts() {
  const res = useApi<ClaudeArtifactsResponse>('/claude-artifacts');
  const { setData, reload } = res;
  const [actionError, setActionError] = useState<string | null>(null);
  const setState = (state: ClaudeArtifactsState) => setData((prev) => (prev ? { ...prev, state } : { items: [], state }));
  useFeed((e) => {
    if (e.type === 'reconnect') reload();
    if (e.type !== 'claude_artifacts') return;
    setState(e.state);
    if (!e.state.refreshing) reload();
  });
  useEffect(() => {
    api.post<{ state: ClaudeArtifactsState }>('/claude-artifacts/refresh', {}).then((r) => setState(r.state), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refresh = () => {
    setActionError(null);
    api.post<{ state: ClaudeArtifactsState }>('/claude-artifacts/refresh', { force: true }).then(
      (r) => setState(r.state),
      (e) => setActionError(errorText(e)),
    );
  };
  const setSchedule = (schedule: ClaudeArtifactsSchedule) => {
    setActionError(null);
    api.put<{ state: ClaudeArtifactsState }>('/claude-artifacts/schedule', { schedule }).then(
      (r) => setState(r.state),
      (e) => setActionError(errorText(e)),
    );
  };
  return { ...res, refresh, setSchedule, actionError };
}

/** The page's kind on claude.ai: Page for plain HTML, else the Artifact type it was made from. */
export function ArtifactTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-bg px-2 text-[11px] font-medium leading-none text-fg-2">
      <Icon name={typeIcon(type)} size={11} />
      {typeLabel(type)}
    </span>
  );
}

/** When the list was fetched, with Refresh. Warns once it is a day old; says so while a run is going. */
export function FreshnessLine({ state, onRefresh, compact }: { state: ClaudeArtifactsState; onRefresh: () => void; compact?: boolean }) {
  const now = useNow(60_000);
  const fresh = freshness(state, now);
  const text = state.refreshing
    ? 'Refreshing from claude.ai'
    : fresh === 'never'
      ? 'Not fetched yet'
      : `Fetched ${relTime(state.last_success_at!, now)}${state.total != null ? ` · ${state.total} artifacts` : ''}`;
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px] text-fg-3" aria-live="polite">
      {state.refreshing ? <Loader size={12} /> : fresh === 'stale' ? <Icon name="alert" size={13} className="text-needs" /> : <Icon name="clock" size={13} />}
      <span className={`min-w-0 truncate ${fresh === 'stale' && !state.refreshing ? 'text-fg-2' : ''}`} title={state.cli_version ? `Claude Code ${state.cli_version}` : undefined}>
        {text}
        {fresh === 'stale' && !state.refreshing && ', over a day ago'}
      </span>
      <Button size="sm" variant="ghost" icon="refresh" busy={state.refreshing} onClick={onRefresh} className={compact ? 'ml-auto' : ''}>
        Refresh
      </Button>
    </div>
  );
}

/** One page: opens on claude.ai in a new tab or the system browser. A page an Omni thread published links to that thread too. */
export function ClaudeArtifactRow({ a, now }: { a: ClaudeArtifact; now: number }) {
  return (
    <li className="group relative flex min-w-0 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-elev md:px-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
        <Icon name={typeIcon(a.type)} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-[13.5px] font-medium text-fg after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          title={a.title}
        >
          {a.title}
        </a>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-fg-3">
          <ArtifactTypeBadge type={a.type} />
          <span>{a.scope === 'mine' ? 'Mine' : 'Shared'}</span>
          {a.updated_on && <span className="font-num">Updated {updatedLabel(a.updated_on, now)}</span>}
          {a.local && (
            <a
              href={href.thread(a.local.thread_id, a.local.artifact_id)}
              className="relative z-10 min-w-0 truncate text-fg-2 underline-offset-2 hover:underline"
              title={`Published by ${a.local.thread_title}`}
            >
              From thread: {a.local.thread_title}
            </a>
          )}
        </div>
      </div>
      <Icon name="arrowUpRight" size={15} className="shrink-0 text-fg-4 transition-colors group-hover:text-fg-2" />
    </li>
  );
}

function ErrorState({ state, onRetry }: { state: ClaudeArtifactsState; onRetry: () => void }) {
  if (!state.error || state.refreshing) return null;
  const t = ERROR_TEXT[state.error.code];
  return (
    <ErrorNote onRetry={onRetry} className="mb-3">
      <span className="font-medium">{t.title}.</span> {t.hint}{' '}
      <a href={GALLERY_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        Open the gallery on claude.ai
      </a>
      .{state.last_success_at && <span className="text-fg-3"> Showing the list fetched {relTime(state.last_success_at)}.</span>}
    </ErrorNote>
  );
}

/** Search, filters, the rows and the auto-refresh choice. `compact`: the phone Library's layout. */
export function ClaudeArtifactsView({ compact }: { compact?: boolean }) {
  const res = useClaudeArtifacts();
  const now = useNow(60_000);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<ClaudeArtifactScopeFilter>('all');
  const [type, setType] = useState('all');
  const items = res.data?.items ?? [];
  const state = res.data?.state;
  const types = useMemo(() => typesIn(items), [items]);
  const list = useMemo(() => filterClaudeArtifacts(items, { q, scope, type }), [items, q, scope, type]);
  const counts = useMemo(
    () => Object.fromEntries(CLAUDE_ARTIFACT_SCOPES.map((s) => [s.id, filterClaudeArtifacts(items, { scope: s.id }).length])) as Record<ClaudeArtifactScopeFilter, number>,
    [items],
  );

  if (res.error && !res.data) return <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>;
  if (!state) return <Loading />;

  const filters = (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact ? '' : 'md:gap-3'}`}>
      <label className={`flex h-9 min-w-0 items-center gap-2 rounded-full bg-surface px-3 text-fg-3 focus-within:shadow-[inset_0_0_0_1px_var(--line-strong)] ${compact ? 'w-full' : 'w-full sm:w-64'}`}>
        <Icon name="search" size={14} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          placeholder="Search claude.ai artifacts"
          aria-label="Search claude.ai artifacts"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3"
        />
      </label>
      <Segmented
        label="Whose"
        value={scope}
        onChange={setScope}
        size="sm"
        options={CLAUDE_ARTIFACT_SCOPES.map((s) => ({
          id: s.id,
          label: s.label,
          badge: counts[s.id] ? <span className="font-num text-[10.5px] text-fg-4 tabular-nums">{counts[s.id]}</span> : undefined,
        }))}
      />
      {types.length > 0 && (
        <Picker
          label="Type"
          value={type}
          onChange={setType}
          options={[{ value: 'all', label: 'All types', avatar: false }, ...types.map((t) => ({ value: t, label: typeLabel(t), icon: typeIcon(t), avatar: false as const }))]}
        />
      )}
    </div>
  );

  const never = !state.last_success_at;
  return (
    <div className="min-w-0">
      <div className="mb-3 flex min-w-0 flex-col gap-3">
        {filters}
        <FreshnessLine state={state} onRefresh={res.refresh} compact={compact} />
      </div>
      <ErrorState state={state} onRetry={res.refresh} />
      {res.actionError && <ErrorNote className="mb-3">{res.actionError}</ErrorNote>}
      {never && state.refreshing ? (
        <Loading label="Fetching your artifacts from claude.ai" />
      ) : never && state.error ? null : list.length === 0 ? (
        <Empty icon="globe" title={items.length ? 'Nothing matches' : 'No artifacts on claude.ai'}>
          {items.length ? 'Try another search or filter.' : 'Pages you publish from Claude show up here after the next refresh.'}
        </Empty>
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-[22px] bg-surface" aria-label="claude.ai artifacts">
          {list.map((a) => (
            <ClaudeArtifactRow key={a.id} a={a} now={now} />
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
        <span>Auto refresh</span>
        <Picker
          label="Auto refresh"
          value={state.schedule}
          onChange={res.setSchedule}
          options={CLAUDE_ARTIFACTS_SCHEDULES.map((s) => ({ value: s.id, label: s.label, avatar: false as const }))}
        />
        <span className="basis-full text-fg-4 sm:basis-auto">Listed by Claude Code under your own login, about a tenth of a cent of usage per run.</span>
      </div>
    </div>
  );
}

/** The Files / claude.ai switch above both lists, as links so each has its own address. */
export function ArtifactSourceSwitch({ source, className = '' }: { source: 'files' | 'claude'; className?: string }) {
  return (
    <Segmented
      label="Artifact source"
      value={source}
      className={className}
      options={[
        { id: 'files', label: 'Files', icon: 'layers', href: href.artifacts() },
        { id: 'claude', label: 'claude.ai', icon: 'globe', href: href.claudeArtifacts() },
      ]}
    />
  );
}
