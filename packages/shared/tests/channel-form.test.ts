import { describe, expect, it } from 'vitest';
import { channelBody, channelForm, channelFormProblem, promptsBody, runBody, slugify, storeDomain, type ChannelRecord } from '../channel-form.ts';
import { setsRun } from '../draft-run.ts';

const acme: ChannelRecord = {
  id: 'acme',
  name: 'Acme',
  kind: 'client',
  repo_path: '/code/acme',
  github_repo: 'acme/theme',
  use_worktree: 0,
  base_dir: null,
  store_domain: 'acme.myshopify.com',
  portal_slug: null,
  browser_headless: 0,
  notes: 'Be nice',
  icon: 'icon:hash',
  default_harness: 'claude-code',
  default_model: 'sonnet',
  default_effort: null,
  prompt_open_pr: 'Use the pr-writer skill.',
};

describe('channel form', () => {
  it('round-trips a stored channel into the same PATCH values', () => {
    const body = channelBody(channelForm(acme), { system: false, github: false });
    expect(body).toEqual({
      name: 'Acme',
      kind: 'client',
      repo_path: '/code/acme',
      use_worktree: 0,
      base_dir: null,
      store_domain: 'acme.myshopify.com',
      portal_slug: null,
      browser_headless: 0,
      notes: 'Be nice',
      icon: 'icon:hash',
      avatar_bg: null,
      avatar_bg_manual: 0,
      default_harness: 'claude-code',
      default_model: 'sonnet',
      default_effort: null,
      prompt_open_pr: 'Use the pr-writer skill.',
      prompt_fix_conflicts: null,
      prompt_fix_checks: null,
    });
  });

  it('sends a blank step prompt as null, which goes back to the built-in one', () => {
    const f = channelForm(acme);
    expect(f.prompts).toEqual({ open: 'Use the pr-writer skill.', conflicts: '', checks: '' });
    expect(promptsBody({ ...f.prompts, open: '  ', checks: ' Fix it. ' })).toEqual({ prompt_open_pr: null, prompt_fix_conflicts: null, prompt_fix_checks: 'Fix it.' });
  });

  it('leaves kind out for a system channel and sends the GitHub repo only when asked', () => {
    const f = { ...channelForm(acme), github_repo: ' acme/other ' };
    expect(channelBody(f, { system: true, github: false })).not.toHaveProperty('kind');
    expect(channelBody(f, { system: false, github: false })).not.toHaveProperty('github_repo');
    expect(channelBody(f, { system: false, github: true }).github_repo).toBe('acme/other');
  });

  it('trims the store domain to its host', () => {
    expect(storeDomain('https://acme.myshopify.com/admin')).toBe('acme.myshopify.com');
    expect(storeDomain('  ')).toBeNull();
  });

  it('starts a new channel as a client with worktrees on and no default run', () => {
    const f = channelForm();
    expect(f).toMatchObject({ kind: 'client', use_worktree: true, showBrowser: false });
    expect(setsRun(f.run)).toBe(false);
    expect(runBody(f.run)).toEqual({ default_harness: null, default_model: null, default_effort: null });
  });

  it('refuses a form with no name, or a new one with a bad id', () => {
    expect(channelFormProblem({ ...channelForm(), name: ' ' }, true)).toBe('Give the channel a name.');
    expect(channelFormProblem({ ...channelForm(), name: '!!', id: slugify('!!') }, true)).toMatch(/id needs/);
    expect(channelFormProblem({ ...channelForm(), name: 'Café Noir', id: slugify('Café Noir') }, true)).toBeNull();
    expect(slugify('Café Noir')).toBe('cafe-noir');
  });
});
