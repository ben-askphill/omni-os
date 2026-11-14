// A channel's settings as a form edits them, and the body POST or PATCH /api/channels takes. The Web UI's channel
// settings and the iOS app's Channel Settings both build their request here, so a value saved on one reads back the
// same on the other.

import { STEP_PROMPT_FIELD, type PRStep, type StepPromptOverrides } from './thread-glance.ts';

export type ChannelKind = 'client' | 'internal' | 'personal';

export const CHANNEL_KINDS: readonly { id: ChannelKind; label: string }[] = [
  { id: 'client', label: 'Client' },
  { id: 'internal', label: 'Internal' },
  { id: 'personal', label: 'Personal' },
];

/** The stored fields of a channel the form reads (GET /api/channels). */
export interface ChannelRecord {
  id: string;
  name: string;
  kind: ChannelKind | 'system';
  repo_path: string | null;
  github_repo: string | null;
  use_worktree: number;
  base_dir: string | null;
  store_domain: string | null;
  portal_slug: string | null;
  browser_headless: number;
  notes: string | null;
  icon: string | null;
  avatar_bg?: string | null;
  avatar_bg_manual?: number;
  default_harness: string | null;
  default_model: string | null;
  default_effort: string | null;
  /** The channel's own Open PR, Fix conflicts and Fix checks prompts, null for the built-in ones. Missing from an older server. */
  prompt_open_pr?: string | null;
  prompt_fix_conflicts?: string | null;
  prompt_fix_checks?: string | null;
}

/** A channel's default run as a picker choice: model '' is the harness default, model "auto" is Auto. All '' is no default, which runs Auto too. */
export interface ChannelRun {
  harness: string;
  model: string;
  effort: string;
}

export interface ChannelForm {
  id: string;
  name: string;
  kind: ChannelKind;
  repo_path: string;
  github_repo: string;
  use_worktree: boolean;
  base_dir: string;
  store_domain: string;
  portal_slug: string;
  showBrowser: boolean;
  notes: string;
  icon: string;
  avatar_bg: string;
  avatar_bg_manual: number;
  run: ChannelRun;
  /** The channel's own prompt per branch step, '' for the built-in one. */
  prompts: Record<PRStep, string>;
}

/** A new channel's form when `c` is left out. */
export function channelForm(c?: ChannelRecord): ChannelForm {
  return {
    id: c?.id ?? '',
    name: c?.name ?? '',
    kind: c && c.kind !== 'system' ? c.kind : 'client',
    repo_path: c?.repo_path ?? '',
    github_repo: c?.github_repo ?? '',
    use_worktree: c ? c.use_worktree === 1 : true,
    base_dir: c?.base_dir ?? '',
    store_domain: c?.store_domain ?? '',
    portal_slug: c?.portal_slug ?? '',
    showBrowser: c ? c.browser_headless === 0 : false,
    notes: c?.notes ?? '',
    icon: c?.icon ?? '',
    avatar_bg: c?.avatar_bg ?? '',
    avatar_bg_manual: c?.avatar_bg_manual ?? 0,
    run: { harness: c?.default_harness ?? '', model: c?.default_model ?? '', effort: c?.default_effort ?? '' },
    prompts: { open: c?.prompt_open_pr ?? '', conflicts: c?.prompt_fix_conflicts ?? '', checks: c?.prompt_fix_checks ?? '' },
  };
}

/** The body for the step prompts: '' goes as null, which clears it back to the built-in prompt. */
export const promptsBody = (prompts: Record<PRStep, string>): Required<StepPromptOverrides> => ({
  [STEP_PROMPT_FIELD.open]: orNull(prompts.open),
  [STEP_PROMPT_FIELD.conflicts]: orNull(prompts.conflicts),
  [STEP_PROMPT_FIELD.checks]: orNull(prompts.checks),
});

/** The PATCH body for a default run: '' fields go as null, which clears them. */
export const runBody = (run: ChannelRun) => ({
  default_harness: orNull(run.harness),
  default_model: orNull(run.model),
  default_effort: orNull(run.effort),
});

/** A channel id: lowercase letters, digits and dashes, 2 to 40 of them. */
export const CHANNEL_ID = /^[a-z0-9-]{2,40}$/;

/** A name as an id: lowercase, accents dropped, anything else a dash. */
export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** A store domain as typed, without a scheme or a path: "https://acme.myshopify.com/admin" is acme.myshopify.com. */
export const storeDomain = (raw: string) => orNull(raw)?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') ?? null;

/** Why the form cannot be sent, or null. */
export function channelFormProblem(f: ChannelForm, isNew: boolean): string | null {
  if (f.avatar_bg && !/^#[0-9a-f]{6}$/i.test(f.avatar_bg)) return 'Use a six-digit hex color for the avatar background.';
  if (!f.name.trim()) return 'Give the channel a name.';
  if (isNew && !CHANNEL_ID.test(f.id)) return 'The id needs 2 to 40 lowercase letters, digits or dashes.';
  return null;
}

/**
 * The body POST /api/channels (with `id` added) or PATCH /api/channels/:id takes. `kind` stays out for a system
 * channel. `github`: send the GitHub repo as typed; leave it out and the server reads it from the repo path, on create
 * and when the path changes (#405).
 */
export function channelBody(f: ChannelForm, opts: { system: boolean; github: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: f.name.trim(),
    repo_path: orNull(f.repo_path),
    use_worktree: f.use_worktree ? 1 : 0,
    base_dir: orNull(f.base_dir),
    store_domain: storeDomain(f.store_domain),
    portal_slug: orNull(f.portal_slug),
    browser_headless: f.showBrowser ? 0 : 1,
    notes: orNull(f.notes),
    icon: orNull(f.icon),
    avatar_bg: orNull(f.avatar_bg),
    avatar_bg_manual: f.avatar_bg_manual,
    ...runBody(f.run),
    ...promptsBody(f.prompts),
  };
  if (!opts.system) body.kind = f.kind;
  if (opts.github) body.github_repo = orNull(f.github_repo);
  return body;
}
