// list_pull_requests for the Conductor (omni.ts) and the external MCP (external/tools.ts): GET /api/prs, narrowed by the
// search the PRs page takes.
import { compactRow } from '@omni/shared/mcp-compact.ts';
import { DEFAULT_PR_QUERY, queryPRs, type ListedPR } from '@omni/shared/pr-query.ts';
import { z } from 'zod';

export const PR_LIST_DEFAULT_LIMIT = 30;
export const PR_LIST_MAX_LIMIT = 200;
export const PR_LIST_STATES = ['open', 'draft', 'merged', 'closed', 'all'] as const;
export type PRListState = (typeof PR_LIST_STATES)[number];

export const PR_LIST_DESCRIPTION =
  "Pull requests across every channel's GitHub repo, open ones by default (includes drafts), newest first: title, repo, author, state, labels and URL. " +
  'Pass state (open, draft, merged, closed, all), channel, search or limit to widen or narrow. `failed` names repos gh could not read.';

export const prListInput = {
  state: z
    .enum(PR_LIST_STATES)
    .optional()
    .describe('Filter by PR state. Default "open" (includes drafts). Pass "merged", "closed", "draft" or "all" for others.'),
  channel: z.string().optional().describe("Channel id from list_channels, to list only that channel's GitHub repo."),
  search: z
    .string()
    .optional()
    .describe('As the PRs page search: every word must appear in the title, number, author, branch or repo, and every label:<name> (quote a name with spaces) must be on the PR.'),
  limit: z.number().int().min(1).max(PR_LIST_MAX_LIMIT).optional().describe(`Max PRs to return. Default ${PR_LIST_DEFAULT_LIMIT}.`),
};

const STATE_FILTER: Record<PRListState, string[] | null> = {
  open: ['open', 'draft'],
  draft: ['draft'],
  merged: ['merged'],
  closed: ['closed'],
  all: null,
};

export interface PRListOptions {
  search?: string;
  state?: PRListState;
  repo?: string | null;
  limit?: number;
}

export function prList(all: { prs: (ListedPR & { url: string })[]; failed: unknown }, opts: PRListOptions | string = {}) {
  const { search = '', state = 'open', repo = null, limit = PR_LIST_DEFAULT_LIMIT } = typeof opts === 'string' ? { search: opts } : opts;
  const states = STATE_FILTER[state];
  const filters = states ? { state: states } : {};
  const matched = queryPRs(all.prs, { ...DEFAULT_PR_QUERY, search, filters, repo }, null).flatMap((g) => g.prs);
  const sliced = matched.slice(0, limit);
  const rowState = (p: ListedPR) => (p.state === 'OPEN' && p.isDraft ? 'DRAFT' : p.state);
  return {
    prs: sliced.map((p) =>
      compactRow({ repo: p.repo, number: p.number, title: p.title, author: p.author?.login ?? null, state: rowState(p), labels: p.labels ?? [], url: p.url, updated_at: p.updatedAt }),
    ),
    ...(matched.length > sliced.length && { total: matched.length }),
    failed: all.failed,
  };
}

/**
 * What set_auto_merge does: read the PR's auto-merge, or turn it off. Never on: arming merges with no further step, so
 * only the person arms it, in the PR view. The server refuses an arm from the install token too (github-api.ts).
 */
export function autoMergeStep(enabled: boolean | undefined, user = 'the user'): { kind: 'read' } | { kind: 'disable'; body: { enabled: false } } {
  if (enabled === true) throw new Error(`Agents cannot turn auto-merge on. Ask ${user} to arm it with the slide in the PR view.`);
  return enabled === false ? { kind: 'disable', body: { enabled: false } } : { kind: 'read' };
}
