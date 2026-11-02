import type { PRDetail } from '@omni/client-core';

export function prDetail(over: Partial<PRDetail> = {}): PRDetail {
  return {
    number: 12,
    title: 'Size guide drawer',
    author: { login: 'ben' },
    headRefName: 'omni/5313f55a',
    baseRefName: 'main',
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-11-02T10:00:00Z',
    reviewDecision: null,
    url: 'https://github.com/acme/shop/pull/12',
    additions: 40,
    deletions: 3,
    mergeable: 'MERGEABLE',
    checks: { passed: 2, failed: 0, pending: 0 },
    body: '',
    files: [{ path: 'product.js', additions: 40, deletions: 3 }],
    reviews: [],
    comments: [],
    checkRuns: [{ name: 'build', state: 'SUCCESS' }],
    diff: '',
    ...over,
  };
}
