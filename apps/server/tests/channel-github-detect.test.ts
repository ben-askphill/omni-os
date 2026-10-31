import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The channel's GitHub repo is read from its repo path (#405): the clients leave it out unless detection failed or
// it was typed, so a moved path reads it again and an unchanged one keeps it.

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
let first: string;
let second: string;

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  // Plain folders, not git repos, so `gh repo view` finds nothing in them.
  first = join(H.tmp, 'repo-a');
  second = join(H.tmp, 'repo-b');
  mkdirSync(first, { recursive: true });
  mkdirSync(second, { recursive: true });
  H.db.channels.create({ id: 'detect', name: 'Detect', kind: 'client', use_worktree: 1, repo_path: first, github_repo: 'acme/typed' });
});

const patch = async (body: unknown) => {
  const res = await app.request('/api/channels/detect', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as any;
};

describe('GitHub repo detection on PATCH', () => {
  it('keeps the GitHub repo when the path stays and none is sent', async () => {
    expect((await patch({ repo_path: first, notes: 'x' })).github_repo).toBe('acme/typed');
  });

  it('keeps a typed GitHub repo when the path moves with it', async () => {
    expect((await patch({ repo_path: second, github_repo: 'acme/other' })).github_repo).toBe('acme/other');
  });

  it('reads it again when the path moves without one, and clears it when nothing is found', async () => {
    const out = await patch({ repo_path: first });
    expect(out.repo_path).toBe(first);
    expect(out.github_repo).toBeNull();
  });
});
