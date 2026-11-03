// The PRs page's search, sort, filters and groups: what GET /api/prs lists, narrowed to what the toolbar asks for.
// packages/test-fixtures/pr-query.json holds the cases.
import { prBadge } from './thread-glance.ts';

/** The parts of a GET /api/prs row these rules read. */
export interface ListedPR {
  number: number;
  title: string;
  author: { login: string } | null;
  headRefName: string;
  repo: string;
  state?: string;
  isDraft: boolean;
  updatedAt: string;
  /** Absent from an older server's answer. */
  createdAt?: string;
  reviewDecision: string | null;
  checks: { passed: number; failed: number; pending: number };
  labels?: string[];
  /** Logins asked to review. */
  reviewRequests?: string[];
}

export const PR_SORTS = [
  { value: 'open', label: 'Open first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'repo', label: 'Repo' },
  { value: 'title', label: 'Title' },
] as const;
export type PRSort = (typeof PR_SORTS)[number]['value'];

const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
const created = (p: ListedPR) => time(p.createdAt ?? p.updatedAt);
const text = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x < y ? -1 : x > y ? 1 : 0;
};
const isOpen = (p: ListedPR) => (p.state ?? 'OPEN') === 'OPEN';
const byUpdated = (a: ListedPR, b: ListedPR) => time(b.updatedAt) - time(a.updatedAt);

const SORTS: Record<PRSort, (a: ListedPR, b: ListedPR) => number> = {
  open: (a, b) => Number(isOpen(b)) - Number(isOpen(a)) || byUpdated(a, b),
  updated: byUpdated,
  newest: (a, b) => created(b) - created(a),
  oldest: (a, b) => created(a) - created(b),
  repo: (a, b) => text(a.repo, b.repo) || byUpdated(a, b),
  title: (a, b) => text(a.title, b.title),
};

export const PR_FACETS = ['state', 'review', 'checks', 'author', 'label'] as const;
export type PRFacet = (typeof PR_FACETS)[number];
/** Values picked per facet. A PR passes a facet when it has any picked value, and the filters when it passes every facet. */
export type PRFilters = Partial<Record<PRFacet, string[]>>;

interface FacetSpec {
  title: string;
  of: (p: ListedPR) => string[];
  /** The values to offer in this order, with their labels. A facet without them offers the values its PRs have. */
  fixed?: { value: string; label: string }[];
}

const REVIEW: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' };

export const FACETS: Record<PRFacet, FacetSpec> = {
  state: {
    title: 'State',
    of: (p) => [prBadge(p).label],
    fixed: [
      { value: 'open', label: 'Open' },
      { value: 'draft', label: 'Draft' },
      { value: 'merged', label: 'Merged' },
      { value: 'closed', label: 'Closed' },
    ],
  },
  review: {
    title: 'Review',
    of: (p) => [REVIEW[p.reviewDecision ?? ''] ?? 'none'],
    fixed: [
      { value: 'approved', label: 'Approved' },
      { value: 'changes', label: 'Changes requested' },
      { value: 'required', label: 'Review required' },
      { value: 'none', label: 'No review decision' },
    ],
  },
  checks: {
    title: 'Checks',
    of: ({ checks: c }) => [c.failed ? 'failing' : c.pending ? 'pending' : c.passed ? 'passing' : 'none'],
    fixed: [
      { value: 'passing', label: 'Passing' },
      { value: 'failing', label: 'Failing' },
      { value: 'pending', label: 'Running' },
      { value: 'none', label: 'No checks' },
    ],
  },
  author: { title: 'Author', of: (p) => [p.author?.login ?? 'unknown'] },
  label: { title: 'Label', of: (p) => p.labels ?? [] },
};

export interface FacetOption {
  value: string;
  label: string;
  /** How many of the PRs given have it. */
  count: number;
}

/**
 * What a facet offers for these PRs: a fixed facet's values that any PR has, else every value the PRs have, most used
 * first. A picked value stays listed at 0 so it can be unpicked.
 */
export function facetOptions(prs: ListedPR[], facet: PRFacet, picked: string[] = []): FacetOption[] {
  const spec = FACETS[facet];
  const counts = new Map<string, number>();
  for (const p of prs) for (const v of new Set(spec.of(p))) counts.set(v, (counts.get(v) ?? 0) + 1);
  const listed = (v: string) => (counts.get(v) ?? 0) > 0 || picked.includes(v);
  if (spec.fixed) return spec.fixed.filter((o) => listed(o.value)).map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }));
  const values = [...new Set([...counts.keys(), ...picked])];
  return values
    .map((value) => ({ value, label: value, count: counts.get(value) ?? 0 }))
    .sort((a, b) => b.count - a.count || text(a.value, b.value));
}

/** Picks a value, or unpicks it. A facet left with none is dropped. */
export function toggleFilter(filters: PRFilters, facet: PRFacet, value: string): PRFilters {
  const now = filters[facet] ?? [];
  const next = now.includes(value) ? now.filter((v) => v !== value) : [...now, value];
  const { [facet]: _, ...rest } = filters;
  return next.length ? { ...rest, [facet]: next } : rest;
}

export const filterCount = (filters: PRFilters) => PR_FACETS.reduce((n, f) => n + (filters[f]?.length ?? 0), 0);

/** Each picked value with its facet, in facet order, for the chips under the toolbar. */
export function pickedFilters(filters: PRFilters): { facet: PRFacet; value: string; label: string }[] {
  return PR_FACETS.flatMap((facet) =>
    (filters[facet] ?? []).map((value) => ({ facet, value, label: FACETS[facet].fixed?.find((o) => o.value === value)?.label ?? value })),
  );
}

export interface PRSearch {
  /** Lower-cased words and quoted phrases, each of which must appear in the PR's title, number, author, branch or repo. */
  words: string[];
  /** Lower-cased `label:` names, each of which the PR must have. */
  labels: string[];
}

/** `fix label:bug label:"good first issue"` into words and labels. A `label:` with no name yet is skipped. */
export function parseSearch(input: string): PRSearch {
  const out: PRSearch = { words: [], labels: [] };
  for (const m of input.matchAll(/(label):(?:"([^"]*)"?|(\S*))|"([^"]*)"?|(\S+)/gi)) {
    const value = (m[1] ? (m[2] ?? m[3]) : (m[4] ?? m[5])).trim().toLowerCase();
    if (value) (m[1] ? out.labels : out.words).push(value);
  }
  return out;
}

function matches(p: ListedPR, s: PRSearch) {
  const hay = `${p.title} #${p.number} ${p.author?.login ?? ''} ${p.headRefName} ${p.repo}`.toLowerCase();
  const labels = (p.labels ?? []).map((l) => l.toLowerCase());
  return s.words.every((w) => hay.includes(w)) && s.labels.every((l) => labels.includes(l));
}

export const PR_GROUPS = [
  { key: 'authored', label: 'Authored', icon: 'pencil' },
  { key: 'review', label: 'Review requested', icon: 'inbox' },
  { key: 'other', label: 'Others', icon: 'pr' },
] as const;
export type PRGroupKey = (typeof PR_GROUPS)[number]['key'];

/** Yours, then the ones you are asked to review, then the rest. Every PR is in "other" when the login is unknown. */
export function groupOf(p: ListedPR, viewer: string | null): PRGroupKey {
  const me = viewer?.toLowerCase();
  if (!me) return 'other';
  if (p.author?.login.toLowerCase() === me) return 'authored';
  return p.reviewRequests?.some((r) => r.toLowerCase() === me) ? 'review' : 'other';
}

export interface PRQuery {
  search: string;
  sort: PRSort;
  filters: PRFilters;
  /** The one repo to list, or null for all of them. */
  repo: string | null;
}

export const DEFAULT_PR_QUERY: PRQuery = { search: '', sort: 'open', filters: {}, repo: null };

/** Only the PRs in the picked repo, or all of them. Filters count their options over these. */
export const inScope = <T extends ListedPR>(prs: T[], repo: string | null) => (repo ? prs.filter((p) => p.repo === repo) : prs);

/** Whether search or filters hide anything, so an empty result reads "no match" rather than "no PRs". */
export const isNarrowed = (q: PRQuery) => !!q.search.trim() || filterCount(q.filters) > 0;

export interface PRGroup<T> {
  key: PRGroupKey;
  label: string;
  icon: string;
  prs: T[];
}

/** The PRs the toolbar asks for, sorted, in their groups. A group with none is left out. */
export function queryPRs<T extends ListedPR>(prs: T[], q: PRQuery, viewer: string | null): PRGroup<T>[] {
  const search = parseSearch(q.search);
  const picked = PR_FACETS.flatMap((f) => (q.filters[f]?.length ? [[f, q.filters[f]] as const] : []));
  const shown = inScope(prs, q.repo)
    .filter((p) => matches(p, search) && picked.every(([f, values]) => FACETS[f].of(p).some((v) => values.includes(v))))
    .sort(SORTS[q.sort]);
  return PR_GROUPS.map((g) => ({ ...g, prs: shown.filter((p) => groupOf(p, viewer) === g.key) })).filter((g) => g.prs.length);
}
