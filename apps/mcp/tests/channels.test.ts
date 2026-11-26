import { describe, expect, it } from 'vitest';
import { channelDetail, channelIndexRow } from '../channels.ts';

describe('list_channels compact index and detail (#1007)', () => {
  it('includes only non-default, non-empty optional fields in the compact index', () => {
    const plain = channelIndexRow({
      id: 'acme',
      name: 'Acme',
      kind: 'client',
      store_domain: null,
      github_repo: '',
      running: 0,
      notes: 'Long deployment notes that child threads already receive.',
      access_level: null,
      access_default: 'ask',
      connector_access: null,
      worktree_include: '.env.local',
      worktree_shared: 'node_modules',
      folders: [],
    });
    expect(plain).toEqual({ id: 'acme', name: 'Acme', kind: 'client' });

    const rich = channelIndexRow({
      id: 'shop',
      name: 'Shop',
      kind: 'client',
      store_domain: 'shop.myshopify.com',
      github_repo: 'org/shop',
      running: 2,
      notes: 'Stays off index.',
      access_level: 'full',
      access_default: 'ask',
      connector_access: '{"gmail":"off"}',
      folders: [{ id: 'f1', name: 'Checkout', count: 3, threads: [{ title: 'Fix cart' }] }],
    });
    expect(rich).toEqual({
      id: 'shop',
      name: 'Shop',
      kind: 'client',
      store: 'shop.myshopify.com',
      repo: 'org/shop',
      running: 2,
      folder_count: 1,
      access: 'Full access, Gmail off',
    });
  });

  it('omits access when level and connector overrides match the install default, and includes it when a connector differs', () => {
    const matchingDefault = channelIndexRow({
      id: 'c1',
      name: 'C1',
      kind: 'internal',
      running: 0,
      access_level: 'ask',
      access_default: 'ask',
      connector_access: '{"gmail":"ask"}',
      folders: [],
    });
    expect(matchingDefault).not.toHaveProperty('access');

    const connectorApart = channelIndexRow({
      id: 'c2',
      name: 'C2',
      kind: 'internal',
      running: 0,
      access_level: null,
      access_default: 'full',
      connector_access: '{"gmail":"off"}',
      folders: [],
    });
    expect(connectorApart.access).toBe('Full access, Gmail off');
  });

  it('returns folders with up to 3 recent titles, notes, worktree lists and effective access on detail', () => {
    const detail = channelDetail({
      id: 'shop',
      name: 'Shop',
      kind: 'client',
      store_domain: 'shop.myshopify.com',
      github_repo: 'org/shop',
      running: 0,
      notes: 'Deploy only after smoke tests.',
      worktree_include: '.env\n.env.local',
      worktree_shared: 'node_modules',
      access_level: null,
      access_default: 'ask',
      connector_access: null,
      folders: [
        {
          id: 'f1',
          name: 'Checkout',
          count: 4,
          threads: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }, { title: 'Four' }],
        },
        { id: 'f2', name: 'Empty', count: 0, threads: [] },
      ],
    });
    expect(detail).toEqual({
      id: 'shop',
      name: 'Shop',
      kind: 'client',
      store: 'shop.myshopify.com',
      repo: 'org/shop',
      notes: 'Deploy only after smoke tests.',
      copy_into_worktrees: ['.env', '.env.local'],
      shared_directories: ['node_modules'],
      folders: [
        { id: 'f1', name: 'Checkout', threads: 4, recent: ['One', 'Two', 'Three'] },
        { id: 'f2', name: 'Empty', threads: 0 },
      ],
      access: 'Ask first',
    });
  });

  it('stays under 3,100 characters for 24 channels and 76 folders', () => {
    const rows = Array.from({ length: 24 }, (_, i) => {
      const folderCount = i < 4 ? 0 : i < 12 ? 3 : 4;
      const n = i === 23 ? folderCount + 4 : folderCount;
      return channelIndexRow({
        id: `channel-${String(i + 1).padStart(2, '0')}`,
        name: `Client Project ${i + 1}`,
        kind: i < 4 ? 'personal' : 'client',
        store_domain: i % 3 === 0 ? `store-${i + 1}.myshopify.com` : null,
        github_repo: i % 2 === 0 ? `org/project-repo-${i + 1}` : null,
        running: i < 2 ? 1 : 0,
        notes: i % 3 === 0 ? `Deployment notes and workflow rules for project ${i + 1}. Always run checks before pushing.` : null,
        access_level: i % 4 === 0 ? 'full' : null,
        access_default: 'ask',
        connector_access: {},
        folders: Array.from({ length: n }, (_, j) => ({
          id: `00000000-0000-4000-8000-${String(i * 100 + j).padStart(12, '0')}`,
          name: `Workstream ${j + 1}`,
          count: 4,
          threads: [{ title: `Feature ${j + 1}` }],
        })),
      });
    });
    const raw = JSON.stringify(rows);
    expect(raw.length).toBeLessThan(3100);
  });
});
