// list_pull_requests for the Conductor (omni.ts) and the external MCP (external/tools.ts): GET /api/prs, narrowed by the
// search the PRs page takes.
import { DEFAULT_PR_QUERY, queryPRs, type ListedPR } from '@omni/shared/pr-query.ts';
import { z } from 'zod';

export const PR_LIST_DESCRIPTION =
  "Pull requests across every channel's GitHub repo, open ones first, then newest first: title, repo, author, state, labels and URL. " +
  '`failed` names repos gh could not read.';

export const prListInput = {
  search: z
    .string()
    .optional()
    .describe('As the PRs page search: every word must appear in the title, number, author, branch or repo, and every label:<name> (quote a name with spaces) must be on the PR.'),
};

export function prList(all: { prs: (ListedPR & { url: string })[]; failed: unknown }, search = '') {
  const prs = queryPRs(all.prs, { ...DEFAULT_PR_QUERY, search }, null).flatMap((g) => g.prs);
  const state = (p: ListedPR) => (p.state === 'OPEN' && p.isDraft ? 'DRAFT' : p.state);
  return {
    prs: prs.map((p) => ({ repo: p.repo, number: p.number, title: p.title, author: p.author?.login ?? null, state: state(p), labels: p.labels ?? [], url: p.url, updated_at: p.updatedAt })),
    failed: all.failed,
  };
}
