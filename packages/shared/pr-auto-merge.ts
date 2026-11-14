// What a PR view says about auto-merge: whether it is armed, with which method and by whom, and the words on its
// controls. Desktop web, the phone web PR screen and the iOS app share it.

/** A PR's armed auto-merge, as `gh pr view --json autoMergeRequest` reports it. null when off. */
export interface AutoMergeRequest {
  enabledAt?: string;
  enabledBy?: { login: string } | null;
  /** SQUASH, MERGE or REBASE. */
  mergeMethod?: string;
}

const METHOD: Record<string, string> = { SQUASH: 'Squashes', MERGE: 'Merges with a merge commit', REBASE: 'Rebases' };

export interface AutoMergeView {
  on: boolean;
  title: string;
  /** What happens, and how: short enough for one phone row. */
  detail: string;
  /** Who turned it on, as "Turned on by ben", or null. */
  by: string | null;
}

export const AUTO_MERGE_COPY = {
  arm: 'Turn on auto-merge',
  slide: 'Slide to turn on auto-merge',
  busy: 'Turning on',
  done: 'Auto-merge on',
  disarm: 'Turn off',
  disarming: 'Turning off',
} as const;

/** The auto-merge row: on, with method and who turned it on, or off with what turning it on does. */
export function autoMergeView(a: AutoMergeRequest | null | undefined): AutoMergeView {
  if (!a) return { on: false, title: 'Auto-merge', detail: 'Merges by itself once checks and reviews pass', by: null };
  const method = METHOD[(a.mergeMethod ?? '').toUpperCase()] ?? 'Merges';
  const login = a.enabledBy?.login;
  return { on: true, title: 'Auto-merge is on', detail: `${method} once checks and reviews pass`, by: login ? `Turned on by ${login}` : null };
}
