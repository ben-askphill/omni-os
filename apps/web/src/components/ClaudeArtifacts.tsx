import { useEffect, useMemo, useState } from 'react';
import {
  artifactPreview,
  CLAUDE_ARTIFACT_LAYOUTS,
  CLAUDE_ARTIFACT_SCOPES,
  CLAUDE_ARTIFACTS_SCHEDULES,
  ERROR_TEXT,
  filterClaudeArtifacts,
  freshness,
  GALLERY_URL,
  GRID_MIN_CARD,
  parseLayout,
  typeLabel,
  typesIn,
  updatedLabel,
  type ClaudeArtifact,
  type ClaudeArtifactsLayout,
  type ClaudeArtifactScopeFilter,
  type ClaudeArtifactsResponse,
  type ClaudeArtifactsSchedule,
  type ClaudeArtifactsState,
} from '@omni/shared/claude-artifacts.ts';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi, type Artifact } from '../api.ts';
import { href } from '../router.ts';
import { readPref, useFeed, useNow, writePref } from '../store.tsx';
import { ArtifactThumb } from './ArtifactThumb.tsx';
import { Loader } from './brand.tsx';
import { Button, Empty, ErrorNote, Icon, Loading, Picker, Segmented, type IconName } from './ui.tsx';

// Ben's claude.ai Artifacts (apps/server/claude-artifacts.ts): the list on the Artifacts page's claude.ai switch and the
// phone Library's, as rows or a grid of cards. Opening one leaves Omni on its https link: a new tab in a browser,
// the Claude app in the desktop app when it is installed and the browser otherwise (apps/desktop/src/open-external.ts),
// and on a phone Safari hands it to the Claude app through claude.ai's universal links. A browser cannot tell whether
// the Claude app is installed, so it never tries the `claude:` scheme.

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

/**
 * Hover, press and keyboard focus (not a click's focus, which would leave an opened card lit) for a row or card. surface-3 is a step past both the resting
 * surface and the page's bg in light and dark, so a hovered row never matches the page behind the list.
 */
const PRESSABLE =
  'transition-colors hover:bg-surface-3 active:bg-surface-3 has-[a:focus-visible]:bg-surface-3 has-[a:focus-visible]:shadow-[inset_0_0_0_2px_var(--line-strong)]';

const LAYOUT_PREF = 'claudeArtifacts.layout';
const LAYOUT_ICON: Record<ClaudeArtifactsLayout, IconName> = { list: 'menu', grid: 'grid' };

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
    <li className={`group relative flex min-w-0 items-center gap-3 px-3 py-2.5 md:px-4 ${PRESSABLE}`}>
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
      <Icon name="arrowUpRight" size={15} className="shrink-0 text-fg-4 transition-colors group-hover:text-fg-2 group-has-[a:focus-visible]:text-fg-2" />
    </li>
  );
}

/**
 * A card's picture: the local file when an Omni thread published the page (served by Omni, never fetched from
 * claude.ai, which has no preview to fetch), else its type's drawing.
 */
function PreviewTile({ a, compact }: { a: ClaudeArtifact; compact?: boolean }) {
  const p = artifactPreview(a);
  if (p.kind === 'local') {
    // A quarter scale on every width, so the page lays out as on a laptop, not at a card's width.
    return <ArtifactThumb a={{ id: p.artifact_id, kind: p.file_kind as Artifact['kind'], updated_at: p.updated_at }} />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-fg-4">
      <Icon name={typeIcon(p.type)} size={compact ? 24 : 28} strokeWidth={1.25} />
    </div>
  );
}

/** One page as a grid card: its preview, title, badges, and the thread that published it. Opens like a row. */
export function ClaudeArtifactCard({ a, now, compact }: { a: ClaudeArtifact; now: number; compact?: boolean }) {
  return (
    <li className={`group relative flex min-w-0 flex-col rounded-[22px] bg-surface p-1.5 ${PRESSABLE}`}>
      <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
        <PreviewTile a={a} compact={compact} />
        <span className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-elev text-fg-4 shadow-[var(--shadow-card)] transition-colors group-hover:text-fg-2 group-has-[a:focus-visible]:text-fg-2">
          <Icon name="arrowUpRight" size={13} />
        </span>
      </div>
      <div className="min-w-0 px-2 pt-2.5 pb-1.5">
        <a
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-[13.5px] font-medium text-fg after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          title={a.title}
        >
          {a.title}
        </a>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-fg-3">
          <ArtifactTypeBadge type={a.type} />
          <span>{a.scope === 'mine' ? 'Mine' : 'Shared'}</span>
          {a.updated_on && <span className="font-num">{updatedLabel(a.updated_on, now)}</span>}
        </div>
        {a.local && (
          <a
            href={href.thread(a.local.thread_id, a.local.artifact_id)}
            className="relative z-10 mt-1 block min-w-0 truncate text-[11.5px] text-fg-2 underline-offset-2 hover:underline"
            title={`Published by ${a.local.thread_title}`}
          >
            From thread: {a.local.thread_title}
          </a>
        )}
      </div>
    </li>
  );
}

/** The saved choice between rows and cards, the same on every page that shows the list in this browser. */
function useLayout(): [ClaudeArtifactsLayout, (l: ClaudeArtifactsLayout) => void] {
  const [layout, setLayout] = useState(() => parseLayout(readPref<unknown>(LAYOUT_PREF, null)));
  return [
    layout,
    (l) => {
      setLayout(l);
      writePref(LAYOUT_PREF, l);
    },
  ];
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
  const [layout, setLayout] = useLayout();
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
      <Segmented
        label="Layout"
        value={layout}
        onChange={setLayout}
        size="sm"
        radio
        className="ml-auto"
        options={CLAUDE_ARTIFACT_LAYOUTS.map((l) => ({ id: l.id, icon: LAYOUT_ICON[l.id], title: l.label }))}
      />
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
      ) : layout === 'grid' ? (
        <ul
          className="grid gap-3 md:gap-4"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? GRID_MIN_CARD.compact : GRID_MIN_CARD.wide}px, 1fr))` }}
          aria-label="claude.ai artifacts"
        >
          {list.map((a) => (
            <ClaudeArtifactCard key={a.id} a={a} now={now} compact={compact} />
          ))}
        </ul>
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
