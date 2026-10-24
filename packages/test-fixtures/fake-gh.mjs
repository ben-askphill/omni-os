#!/usr/bin/env node
// A stand-in for the gh CLI, for QA runs that need pull requests without GitHub. Put a `gh` link to it first on PATH.
// It answers the calls apps/server/github.ts and apps/server/pr-watch/gh.ts make with fixed PRs; `pr merge` prints what gh prints and changes nothing.
const args = process.argv.slice(2);
const has = (...a) => a.every((x, i) => args[i] === x);
const arg = (name) => args[args.indexOf(name) + 1];

const check = (name, conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, conclusion, status, detailsUrl: `https://github.com/acme/shop/actions/runs/${name.length}/job/${name.length}0` });

const PRS = [
  {
    number: 12, title: 'Add the size guide drawer to product pages', author: { login: 'maya' }, headRefName: 'feat/size-guide', baseRefName: 'main',
    state: 'OPEN', isDraft: false, updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), reviewDecision: 'REVIEW_REQUIRED',
    url: 'https://github.com/acme/shop/pull/12', additions: 71, deletions: 4, mergeable: 'MERGEABLE', headRefOid: '4f9c2d17e8a3b6c05d1e2f3a4b5c6d7e8f9a0b1c',
    statusCheckRollup: [check('lint', 'SUCCESS'), check('theme-check', 'SUCCESS'), check('e2e', 'FAILURE'), check('deploy-preview', '', 'IN_PROGRESS')],
  },
  {
    number: 9, title: 'Draft: cart upsell experiments', author: { login: 'ben' }, headRefName: 'exp/cart-upsell', baseRefName: 'main',
    state: 'OPEN', isDraft: true, updatedAt: new Date(Date.now() - 30 * 3600_000).toISOString(), reviewDecision: null,
    url: 'https://github.com/acme/shop/pull/9', additions: 240, deletions: 12, mergeable: 'CONFLICTING', headRefOid: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b', statusCheckRollup: [],
  },
  {
    number: 7, title: 'Fix the predictive search flicker', author: { login: 'sam' }, headRefName: 'fix/search-flicker', baseRefName: 'main',
    state: 'OPEN', isDraft: false, updatedAt: new Date(Date.now() - 5 * 86400_000).toISOString(), reviewDecision: 'APPROVED',
    url: 'https://github.com/acme/shop/pull/7', additions: 6, deletions: 6, mergeable: 'MERGEABLE', headRefOid: '0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c',
    statusCheckRollup: [check('lint', 'SUCCESS'), check('theme-check', 'SUCCESS')],
  },
];

const DIFF = `diff --git a/sections/size-guide.liquid b/sections/size-guide.liquid
new file mode 100644
index 0000000..3f1c2a1
--- /dev/null
+++ b/sections/size-guide.liquid
@@ -0,0 +1,6 @@
+<size-guide-drawer>
+  <button type="button" data-open>{{ 'products.size_guide' | t }}</button>
+  {% render 'size-table', table: product.metafields.custom.size_table %}
+</size-guide-drawer>
+
+{% schema %}{ "name": "Size guide" }{% endschema %}
diff --git a/assets/product.js b/assets/product.js
index 1a2b3c4..5d6e7f8 100644
--- a/assets/product.js
+++ b/assets/product.js
@@ -10,7 +10,9 @@ export class ProductForm extends HTMLElement {
   connectedCallback() {
     this.form = this.querySelector('form');
-    this.form.addEventListener('submit', this.onSubmit);
+    this.form.addEventListener('submit', this.onSubmit.bind(this));
+    this.drawer = this.querySelector('size-guide-drawer');
+    this.drawer?.addEventListener('open', () => this.trackOpen());
   }
 
   onSubmit(event) {
diff --git a/assets/logo-old.png b/assets/logo.png
similarity index 88%
rename from assets/logo-old.png
rename to assets/logo.png
index 9999999..8888888 100644
Binary files a/assets/logo-old.png and b/assets/logo.png differ
`;

const detail = (p) => ({
  ...p,
  body: `<!-- Thanks for the PR -->\n## What\n\nAdds a **size guide** drawer to product pages.\n\n- Opens from the size picker\n- Reads the table from a metafield\n\n## Testing\n\n- [x] Checked on a real store\n- [ ] Mobile Safari`,
  files: [
    { path: 'sections/size-guide.liquid', additions: 6, deletions: 0 },
    { path: 'assets/product.js', additions: 3, deletions: 1 },
    { path: 'assets/logo.png', additions: 0, deletions: 0 },
  ],
  reviews: [{ author: { login: 'sam' }, state: 'CHANGES_REQUESTED', body: 'Can the table come from a metafield instead of hard coding?', submittedAt: new Date(Date.now() - 2 * 86400_000).toISOString() }],
  comments: [{ author: { login: 'maya' }, body: 'Switched to the metafield.', createdAt: new Date(Date.now() - 86400_000).toISOString() }],
});

// `gh api`, as the PR watch reads it: the signed-in login, and the reviews and comments of PR 12 as `--jq` prints them,
// one JSON object a line. Stamped with the time of the call, so they are always newer than any watch.
const feedback = (kind) => {
  const at = new Date().toISOString();
  const url = 'https://github.com/acme/shop/pull/12';
  const base = { bot: false, assoc: 'MEMBER', at };
  if (kind === 'pulls/12/reviews')
    return [{ ...base, id: 801, user: 'sam', body: 'Can the table come from a metafield instead of hard coding?', url: `${url}#pullrequestreview-801`, commit: PRS[0].headRefOid, state: 'CHANGES_REQUESTED' }];
  if (kind === 'pulls/12/comments')
    return [{ ...base, id: 802, user: 'maya', body: 'This label should go through the translation helper too.', url: `${url}#discussion_r802`, commit: PRS[0].headRefOid, path: 'sections/size-guide.liquid', line: 3 }];
  if (kind === 'issues/12/comments')
    return [
      { ...base, id: 803, user: 'vercel[bot]', bot: true, assoc: 'NONE', body: 'Preview deployed.', url: `${url}#issuecomment-803` },
      { ...base, id: 804, user: 'ben-askphill', body: 'Switched to the metafield.', url: `${url}#issuecomment-804` },
    ];
  return [];
};

if (has('api')) {
  const path = args.find((a, i) => i > 0 && !a.startsWith('-') && args[i - 1] !== '--jq');
  if (path === 'user') console.log('ben-askphill');
  else for (const f of feedback((path ?? '').replace(/^repos\/[^/]+\/[^/]+\//, ''))) console.log(JSON.stringify(f));
} else if (has('repo', 'view')) {
  console.log(JSON.stringify({ nameWithOwner: 'acme/shop' }));
} else if (has('pr', 'list')) {
  const state = arg('--state');
  console.log(JSON.stringify(state === 'open' || state === 'all' ? PRS : []));
} else if (has('pr', 'view')) {
  const p = PRS.find((x) => String(x.number) === args[2]);
  if (!p) { console.error('no pull request found'); process.exit(1); }
  console.log(JSON.stringify(detail(p)));
} else if (has('pr', 'diff')) {
  process.stdout.write(DIFF);
} else if (has('run', 'view')) {
  // `--log-failed`: the job and step names, then a timestamped line, tab separated, as gh prints them.
  const at = '2026-10-24T09:12:03.1234567Z';
  for (const l of ['Run npx playwright test', '  1) size guide drawer opens from the size picker', '     Error: expect(locator).toBeVisible() failed', '     Locator: getByRole(\'dialog\', { name: \'Size guide\' })', '1 failed, 41 passed (38.2s)', '##[error]Process completed with exit code 1.'])
    console.log(`e2e\tRun tests\t${at} ${l}`);
} else if (has('pr', 'merge')) {
  console.log(`Merged pull request #${args[2]} (${args.filter((a) => a.startsWith('--')).join(' ')})`);
} else {
  console.error(`fake gh: unsupported ${args.join(' ')}`);
  process.exit(1);
}
