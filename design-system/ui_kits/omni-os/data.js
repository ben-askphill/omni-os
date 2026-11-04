/* Omni OS UI kit — fake data (channel kinds + nested running threads mirror web/src Sidebar). */
(function () {
  const tk = (a) => a.map(([t, state]) => ({ t, state: state || 'idle' }));
  const channels = [
    { id: 'conductor', name: 'Conductor', kind: 'system', threads: [{ id: 't-4f29', title: 'Volero checkout drop-off', state: 'needs' }] },
    { id: 'vo', code: 'VO', name: 'Volero', kind: 'client', running: 4, needs: 2, domain: 'volero.nl', repo: 'volero/theme', path: '~/work/volero-theme',
      threads: [{ id: 't-4f2b', title: 'Patch shipping-rate script', state: 'running' }, { id: 't-4f27', title: 'Size-guide metafields AW26', state: 'running' }, { id: 't-4f24', title: 'Competitor free-shipping scan', state: 'running' }, { id: 't-4f21', title: 'Low-stock alerts to #ops', state: 'running' }] },
    { id: 'pg', code: 'PG', name: 'Pink Gellac', kind: 'client', running: 2, threads: [{ id: 't-4e90', title: 'Gel kit bundle pricing', state: 'running' }, { id: 't-4e8c', title: 'Returns flow copy NL', state: 'running' }] },
    { id: 'as', code: 'AS', name: 'Acne Studios', kind: 'client', needs: 1 },
    { id: 'ho', code: 'HO', name: 'Halden Outdoor', kind: 'client', running: 1, threads: [{ id: 't-4d71', title: 'Tent size filters', state: 'running' }] },
    { id: 'ml', code: 'ML', name: 'Maison Lune', kind: 'client' },
    { id: 'vb', code: 'VB', name: 'Verde Botanics', kind: 'client', running: 1, threads: [{ id: 't-4d60', title: 'Subscription skip link', state: 'running' }] },
    { id: 'sk', code: 'SK', name: 'Studio Kiln', kind: 'client' },
    { id: 'oa', code: 'OA', name: 'Oaken Audio', kind: 'client', running: 1, threads: [{ id: 't-4d52', title: 'PDP spec table', state: 'running' }] },
    { id: 'in', code: 'IN', name: 'omni-internal', kind: 'internal', running: 1, needs: 1, threads: [{ id: 't-4f0d', title: 'Re-auth GitHub token', state: 'needs' }, { id: 't-4f0a', title: 'Codex adapter tests', state: 'running' }] },
    { id: 'me', code: 'ME', name: 'personal', kind: 'personal' }
  ];


  const H = ['claude-code', 'codex', 'cursor'];
  const C = ['researcher', 'builder', 'store-ops', 'inbox'];
  const hot = [
    { title: 'Pause WEEKEND15 until the shipping patch ships?', taskId: 'T-4F2C', state: 'needs', role: 'store-ops', harness: 'claude-code', time: '3m', preview: 'It stacks with free shipping and hides the rate step for ~30% of NL carts.' },
    { title: 'Approve reply to Maartje about the holiday returns window', taskId: 'T-4F1E', state: 'needs', role: 'inbox', harness: 'claude-code', time: '22m', preview: 'Draft ready: extends returns to 31 Jan for orders from 15 Nov.' },
    { title: 'Patch shipping-rate script in checkout', taskId: 'T-4F2B', state: 'running', role: 'builder', harness: 'claude-code', time: '12m', branch: 'omni/t-4f2b-shipping-rates', preview: 'Editing snippets/shipping-rates.liquid · step 5/9' },
    { title: 'Rebuild size-guide metafields for AW26 outerwear', taskId: 'T-4F27', state: 'running', role: 'builder', harness: 'cursor', time: '31m', branch: 'omni/t-4f27-size-guide', preview: 'Writing 212 metafields, 140 done' },
    { title: 'Scrape competitor free-shipping thresholds (NL/BE/DE)', taskId: 'T-4F24', state: 'running', role: 'researcher', harness: 'codex', time: '44m', preview: 'Checked 9 of 14 stores' },
    { title: 'Sync low-stock alerts to #ops-volero', taskId: 'T-4F21', state: 'running', role: 'store-ops', harness: 'claude-code', time: '1h', preview: 'Automation · every 15 minutes' },
    { title: 'Checkout drop-off after Friday’s deploy', taskId: 'T-4F2A', state: 'done', role: 'researcher', harness: 'codex', time: '4m', preview: 'Shipping → payment fell from 78.3% to 52.1% at 16:40 on 25 Sep.' },
    { title: 'Klaviyo abandoned-cart flow: fix broken image block', taskId: 'T-4F1B', state: 'done', role: 'builder', harness: 'claude-code', time: '38m', preview: 'Fixed in 2 templates, test send passed.' }
  ];
  const quietTitles = [
    ['Returns page copy review', 'Tightened to 140 words, added the BE exception.'], ['PDP image audit — AW26', '38 products missing a back view.'], ['Weekly trading report', 'Revenue +6.2% wk/wk, AOV flat.'], ['Collection sort: bestsellers first', 'Applied to 11 collections.'], ['Update shipping FAQ for BE', 'Published.'], ['Gift card email template', 'Merged in #799.'], ['Fix hreflang tags on /de', '14 templates patched.'], ['Theme app extension cleanup', 'Removed 3 unused blocks.'], ['Cookie banner copy (NL)', 'Waiting on legal, parked.'], ['Search synonyms: “jas” → “jacket”', '22 synonym pairs added.'],
    ['Merchant Center feed errors', '41 errors → 3.'], ['Loyalty tiers draft', 'Three tiers, sent to Maartje.'], ['Black Friday calendar', '6 drops, 2 emails each.'], ['Size chart for knitwear', 'Done.'], ['Refactor cart drawer JS', 'Merged in #791.'], ['Lookbook page — SS27 teaser', 'Draft in theme preview.'], ['Warehouse inventory sync', 'Runs hourly now.'], ['Meta pixel dedupe', 'Event match quality 6.1 → 8.4.'], ['Rewrite About page intro', 'Three options.'], ['Wishlist app evaluation', 'Recommend Swym.'],
    ['Payments migration notes', 'Checklist in the thread.'], ['Newsletter signup A/B', 'Variant B +11% signups.'], ['Customer service macros', '18 macros updated.'], ['Store locator data refresh', '64 stores.'], ['Accessibility pass on header nav', '9 fixes.'], ['Image CDN cache headers', 'TTL 1y on /cdn/shop.'], ['Price rounding rules EU', 'Rounded to .95.'], ['Order confirmation copy', 'Shorter, adds tracking link.'], ['Sitemap cleanup', 'Dropped 212 dead URLs.'], ['Discount stacking audit', 'Found WEEKEND15 overlap.'],
    ['Q4 promo brief for Maartje', 'Sent.'], ['Collection banners for outerwear', '5 banners.'], ['Speed audit — mobile PDP', 'LCP 3.1s → 2.2s.'], ['Tracking page notes', 'Parked.']
  ];
  const groups = ['Today', 'Today', 'Today', 'Today', 'Yesterday', 'Yesterday', 'Yesterday', 'Yesterday', 'Yesterday', 'Fri 25 Sep', 'Fri 25 Sep', 'Fri 25 Sep', 'Fri 25 Sep', 'Thu 24 Sep', 'Thu 24 Sep', 'Thu 24 Sep', 'Thu 24 Sep'];
  const times = { Today: ['11:40', '10:12', '09:55', '08:30'], Yesterday: ['18:20', '16:02', '14:44', '11:10', '09:03'], 'Fri 25 Sep': ['17:31', '16:40', '12:05', '10:22'], 'Thu 24 Sep': ['19:10', '15:00', '13:48', '09:12'] };
  const quiet = quietTitles.map(([title, preview], i) => {
    const g = groups[i] || 'Earlier this month';
    const tt = times[g] ? times[g][i % times[g].length] : ['Sep 22', 'Sep 21', 'Sep 19', 'Sep 18', 'Sep 16', 'Sep 15', 'Sep 12'][i % 7];
    return { title, preview, taskId: 'T-4' + (0xE9F - i * 7).toString(16).toUpperCase(), state: 'settled', role: C[i % 4], harness: H[i % 3], time: tt, group: g };
  });

  const pr = {
    number: 812, repo: 'volero/theme', title: 'Fix shipping-rate script blocking the checkout shipping step', state: 'open',
    branch: 'omni/t-4f2b-shipping-rates', base: 'main', taskId: 'T-4F2B',
    checks: [{ name: 'theme-check', state: 'done', duration: '38s' }, { name: 'lighthouse / checkout', state: 'running', duration: '1m 12s' }, { name: 'playwright / checkout-nl', state: 'queued', duration: '—' }],
    additions: 214, deletions: 38,
    files: [{ path: 'snippets/shipping-rates.liquid', add: 162, del: 31 }, { path: 'assets/checkout-rates.js', add: 44, del: 7 }, { path: 'config/settings_schema.json', add: 8, del: 0 }]
  };

  const funnel = `<!doctype html><html><head><style>body{margin:0;padding:16px 18px;font:13px/1.45 "SF Pro Text",system-ui,-apple-system,sans-serif;color:#17181a;background:#fff}h1{font:500 15px/1.3 "SF Pro Display",system-ui,sans-serif;margin:0 0 2px;letter-spacing:-.01em}p{margin:0 0 12px;color:#6f6e68;font-size:12px}table{width:100%;border-collapse:collapse}th{font-weight:500;font-size:11.5px;color:#6f6e68;text-align:left;border-bottom:1px solid rgb(23 24 26/.16);padding:6px 0}td{border-bottom:1px solid rgb(23 24 26/.08);padding:8px 0}td.n,th.n{text-align:right;font-family:"SF Mono",ui-monospace,monospace;font-size:12px}tr.x td{font-weight:600}.bar{display:inline-block;height:6px;border-radius:3px;background:#17181a;vertical-align:1px}</style></head><body><h1>Checkout funnel, 7 days before vs after 25 Sep 16:40</h1><p>volero.nl · 18,402 sessions reaching cart · Shopify analytics</p><table><tr><th>Step</th><th class="n">Before</th><th class="n">After</th><th class="n">Δ</th><th></th></tr><tr><td>Cart → checkout</td><td class="n">61.2%</td><td class="n">60.4%</td><td class="n">−0.8</td><td><span class="bar" style="width:4px"></span></td></tr><tr><td>Contact → shipping</td><td class="n">88.9%</td><td class="n">88.1%</td><td class="n">−0.8</td><td><span class="bar" style="width:4px"></span></td></tr><tr class="x"><td>Shipping → payment</td><td class="n">78.3%</td><td class="n">52.1%</td><td class="n">−26.2</td><td><span class="bar" style="width:120px"></span></td></tr><tr><td>Payment → order</td><td class="n">91.0%</td><td class="n">90.6%</td><td class="n">−0.4</td><td><span class="bar" style="width:3px"></span></td></tr></table></body></html>`;

  const palette = [
    { id: 'a-new', group: 'Actions', kind: 'command', icon: 'plus', label: 'New thread', sub: 'Start a task' },
    { id: 'g-co', group: 'Go to', kind: 'command', icon: 'target', label: 'Conductor', target: 'conductor' },
    { id: 'g-art', group: 'Go to', kind: 'command', icon: 'layers', label: 'Artifacts' },
    { id: 'g-au', group: 'Go to', kind: 'command', icon: 'zap', label: 'Automations' },
    ...channels.filter((c) => c.id !== 'conductor').map((c) => ({ id: 'ch-' + c.id, group: 'Channels', kind: 'channel', label: '#' + c.name, sub: c.domain || c.repo, meta: c.running ? c.running + ' running' : '', metaLive: true, target: c.id })),
    ...hot.map((t) => ({ id: 'th-' + t.taskId, group: 'Recent threads', kind: 'thread', label: t.title, sub: '#Volero', taskId: t.taskId, state: t.state, target: 'conductor' })),
    ...quiet.slice(0, 8).map((t) => ({ id: 'th-' + t.taskId, group: 'Recent threads', kind: 'thread', label: t.title, sub: '#Volero', taskId: t.taskId, state: 'settled', target: 'vo' })),
    { id: 'x-light', group: 'Theme', kind: 'command', icon: 'sun', label: 'Light theme', action: 'light' },
    { id: 'x-dark', group: 'Theme', kind: 'command', icon: 'moon', label: 'Dark theme', action: 'dark' },
    { id: 'x-den', group: 'Theme', kind: 'command', icon: 'sliders', label: 'Toggle compact density', action: 'density' }
  ];

  const usage = [{ name: 'Claude', five: 0.71, week: 0.48 }, { name: 'Codex', five: 0.93, week: 0.62 }, { name: 'Cursor', five: 0.22, week: null }];

  window.OMNI_DATA = { channels, hot, quiet, pr, funnel, palette, usage };
})();
