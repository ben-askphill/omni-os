#!/usr/bin/env node
// A stand-in for the gh CLI, for QA runs that need pull requests without GitHub. Put a `gh` link to it first on PATH.
// It answers the calls server/github.ts makes with fixed PRs; `pr merge` prints what gh prints and changes nothing.
const args = process.argv.slice(2);
const has = (...a) => a.every((x, i) => args[i] === x);
const arg = (name) => args[args.indexOf(name) + 1];

const check = (name, conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, conclusion, status, detailsUrl: `https://github.com/acme/shop/actions/runs/${name.length}` });

const PRS = [
  {
    number: 12, title: 'Add the size guide drawer to product pages', author: { login: 'maya' }, headRefName: 'feat/size-guide', baseRefName: 'main',
    state: 'OPEN', isDraft: false, updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), reviewDecision: 'REVIEW_REQUIRED',
    url: 'https://github.com/acme/shop/pull/12', additions: 71, deletions: 4, mergeable: 'MERGEABLE',
    statusCheckRollup: [check('lint', 'SUCCESS'), check('theme-check', 'SUCCESS'), check('e2e', 'FAILURE'), check('deploy-preview', '', 'IN_PROGRESS')],
  },
  {
    number: 9, title: 'Draft: cart upsell experiments', author: { login: 'ben' }, headRefName: 'exp/cart-upsell', baseRefName: 'main',
    state: 'OPEN', isDraft: true, updatedAt: new Date(Date.now() - 30 * 3600_000).toISOString(), reviewDecision: null,
    url: 'https://github.com/acme/shop/pull/9', additions: 240, deletions: 12, mergeable: 'CONFLICTING', statusCheckRollup: [],
  },
  {
    number: 7, title: 'Fix the predictive search flicker', author: { login: 'sam' }, headRefName: 'fix/search-flicker', baseRefName: 'main',
    state: 'OPEN', isDraft: false, updatedAt: new Date(Date.now() - 5 * 86400_000).toISOString(), reviewDecision: 'APPROVED',
    url: 'https://github.com/acme/shop/pull/7', additions: 6, deletions: 6, mergeable: 'MERGEABLE',
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

if (has('repo', 'view')) {
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
} else if (has('pr', 'merge')) {
  console.log(`Merged pull request #${args[2]} (${args.filter((a) => a.startsWith('--')).join(' ')})`);
} else {
  console.error(`fake gh: unsupported ${args.join(' ')}`);
  process.exit(1);
}
