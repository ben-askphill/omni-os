/* Omni mobile redesign: fake data. Builds on ../omni-os/data.js (window.OMNI_DATA). */
(function () {
  const D = window.OMNI_DATA;
  const items = [
    { id: 'T-4F2C', state: 'needs', role: 'store-ops', harness: 'claude-code', ch: 'Volero', time: '3m', via: true, kind: 'confirm',
      title: 'Pause WEEKEND15 until the shipping patch ships?',
      body: 'WEEKEND15 stacks with free shipping and hides the rate step for about 30% of NL carts. The builder’s fix is in review as #812.',
      prompt: 'Check whether any running discount makes the shipping-rate bug worse. Don’t change discounts without asking Ben.',
      yes: 'Pause WEEKEND15', no: 'Keep it running', doneText: 'Paused WEEKEND15', steps: 9 },
    { id: 'T-4F1E', state: 'needs', role: 'inbox', harness: 'claude-code', ch: 'Volero', time: '22m', kind: 'draft',
      title: 'Send the reply to Maartje about the holiday returns window?',
      quote: 'Hi Maartje, we’ll extend returns to 31 January for every order placed from 15 November. The returns page and the order confirmation now say the same.',
      prompt: 'Draft a reply to Maartje’s email about holiday returns.',
      yes: 'Send reply', no: 'Edit', doneText: 'Reply sent to Maartje', steps: 6 },
    { id: 'T-4E91', state: 'needs', role: 'builder', harness: 'codex', ch: 'Pink Gellac', time: '41m', kind: 'choice',
      title: 'Which discount should the gel kit bundle carry?',
      options: [{ l: '15% off', s: 'Matches the AW promo. Margin stays at 41%.', rec: true }, { l: '€10 off', s: 'Simpler on the PDP. Margin 38%.' }, { l: 'No discount, free top coat', s: 'Keeps the price anchors intact.' }],
      prompt: 'Set up the gel kit bundle on the PDP and in the cart.',
      yes: 'Continue', doneText: 'Going with 15% off', steps: 11 },
    { id: 'T-4F2B', state: 'running', role: 'builder', harness: 'claude-code', ch: 'Volero', time: '12m', meta: 'step 5/9', now: 'snippets/shipping-rates.liquid', nowVerb: 'Editing', pr: 812,
      title: 'Patch shipping-rate script in checkout', prompt: 'Fix the shipping-rate script so the rate step loads for every NL cart. Open a PR, don’t merge.',
      plan: ['Reproduce on a NL cart', 'Find the blocking call', 'Move rates to the async loader', 'Guard the free-shipping branch', 'Update snippets/shipping-rates.liquid', 'Run theme-check', 'Run checkout tests', 'Open PR', 'Report to the Conductor'], step: 5 },
    { id: 'T-4F27', state: 'running', role: 'builder', harness: 'cursor', ch: 'Volero', time: '31m', meta: '140 of 212', now: 'metafields.aw26_outerwear', nowVerb: 'Writing',
      title: 'Rebuild size-guide metafields for AW26 outerwear', prompt: 'Rebuild the size-guide metafields for AW26 outerwear from the new sheet.',
      plan: ['Read the size sheet', 'Map sizes to products', 'Write metafields', 'Spot-check 10 PDPs', 'Report'], step: 3 },
    { id: 'T-4F24', state: 'running', role: 'researcher', harness: 'codex', ch: 'Volero', time: '44m', meta: '9 of 14 stores', now: 'bever.nl/checkout', nowVerb: 'Checking',
      title: 'Scrape competitor free-shipping thresholds (NL/BE/DE)', prompt: 'Find the free-shipping thresholds of our 14 closest competitors in NL, BE and DE.',
      plan: ['List 14 competitors', 'Check each checkout', 'Table by country', 'Report'], step: 2 },
    { id: 'T-4D71', state: 'running', role: 'builder', harness: 'claude-code', ch: 'Halden Outdoor', time: '1h', meta: 'step 3/6', now: 'theme-check', nowVerb: 'Running',
      title: 'Tent size filters', prompt: 'Add sleeping-capacity filters to the tents collection.',
      plan: ['Add metafield', 'Backfill 64 tents', 'Add filter', 'Theme-check', 'Preview', 'Report'], step: 3 },
    { id: 'T-4F2A', state: 'done', role: 'researcher', harness: 'codex', ch: 'Volero', time: '4m', via: true, artifact: 'funnel-before-after.html', steps: 14, failed: 1, dur: '6m',
      title: 'Checkout drop-off after Friday’s deploy', prompt: 'Find what changed in Volero’s checkout on 25 September and bring the numbers back.',
      summary: 'Shipping → payment fell from 78.3% to 52.1% at 16:40 on 25 Sep, the minute the new shipping-rate script went live. Every other step moved less than a point.' },
    { id: 'T-4F1B', state: 'done', role: 'builder', harness: 'claude-code', ch: 'Volero', time: '38m', diff: [12, 4], files: 2, steps: 8, dur: '4m',
      title: 'Klaviyo abandoned-cart flow: fix broken image block', prompt: 'The abandoned-cart email shows a broken image block. Fix it.',
      summary: 'The image block pointed at a deleted CDN path. Fixed in 2 templates; the test send to Ben rendered correctly.' },
    { id: 'T-4E9F', state: 'done', role: 'researcher', harness: 'codex', ch: 'Volero', time: '1h', artifact: 'weekly-trading-wk43.html', steps: 6, dur: '3m',
      title: 'Weekly trading report', prompt: 'Weekly trading report for week 43.', summary: 'Revenue +6.2% week on week. AOV flat at €84.10. Outerwear carried the week.' },
    { id: 'T-4E8C', state: 'done', role: 'builder', harness: 'cursor', ch: 'Pink Gellac', time: '2h', diff: [38, 51], files: 3, steps: 12, dur: '9m',
      title: 'Returns flow copy NL', prompt: 'Tighten the returns flow copy in Dutch.', summary: 'Tightened to 140 words and added the BE exception.' }
  ];
  const conductor = {
    id: 'T-4F29', state: 'needs', role: 'conductor', ch: 'Conductor', time: '14:02', title: 'Volero checkout drop-off after Friday’s deploy',
    prompt: 'Conversion dropped after Friday’s deploy on Volero. Find out why and fix it, but don’t touch discounts without asking me.',
    children: ['T-4F2A', 'T-4F2B', 'T-4F2C']
  };
  const artifacts = [
    { id: 'a1', name: 'funnel-before-after.html', type: 'report', ch: 'Volero', role: 'researcher', time: '4m', thread: 'T-4F2A', live: true },
    { id: 'a2', name: '#812 Fix shipping-rate script', type: 'pr', ch: 'Volero', role: 'builder', time: '12m', thread: 'T-4F2B' },
    { id: 'a3', name: 'weekly-trading-wk43.html', type: 'report', ch: 'Volero', role: 'researcher', time: '1h', thread: 'T-4E9F' },
    { id: 'a4', name: 'returns-copy-nl.md', type: 'file', ch: 'Pink Gellac', role: 'builder', time: '2h', thread: 'T-4E8C' },
    { id: 'a5', name: 'size-guide-aw26.csv', type: 'file', ch: 'Volero', role: 'builder', time: 'Yesterday', thread: 'T-4F27' },
    { id: 'a6', name: 'hreflang-audit.html', type: 'report', ch: 'Volero', role: 'researcher', time: 'Yesterday' },
    { id: 'a7', name: '#799 Gift card email template', type: 'pr', ch: 'Volero', role: 'builder', time: 'Thu' },
    { id: 'a8', name: 'pg-bundle-pricing.html', type: 'report', ch: 'Pink Gellac', role: 'researcher', time: 'Thu' }
  ];
  const steps = [
    { t: 'Read', a: 'analytics/checkout_funnel?from=2026-09-18', ok: true },
    { t: 'Read', a: 'analytics/checkout_funnel?from=2026-09-25', ok: true },
    { t: 'Bash', a: 'git log --since=2026-09-25 -- snippets/', ok: true, out: '9e1c0af shipping-rates: async loader (Fri 16:38)' },
    { t: 'Grep', a: 'shipping-rates in theme/**/*.liquid', ok: true, out: '3 matches' },
    { t: 'Browser', a: 'volero.nl/checkout as a NL cart', ok: false, out: 'Rate step timed out after 12s' },
    { t: 'Browser', a: 'volero.nl/checkout with WEEKEND15', ok: true, out: 'Rate step hidden' },
    { t: 'Write', a: 'funnel-before-after.html', ok: true }
  ];
  const automations = [
    { name: 'Low-stock alerts to #ops-volero', when: 'Every 15 minutes', last: 'Ran 6m ago', state: 'done' },
    { name: 'Weekly trading report', when: 'Mondays 08:00', last: 'Ran Mon 08:00', state: 'done' },
    { name: 'Merchant Center feed check', when: 'Daily 06:00', last: 'Failed today 06:00', state: 'failed' }
  ];
  window.MOBILE = { items, conductor, artifacts, steps, automations, channels: D.channels.filter((c) => c.id !== 'conductor'), pr: D.pr, funnel: D.funnel, usage: D.usage, quiet: D.quiet };
})();
